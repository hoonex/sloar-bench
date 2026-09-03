function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function staleBuildError(message = "build snapshot is stale") {
  const error = new Error(message);
  error.name = "StaleBuildError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export class GraphEngine {
  constructor({ worker, publisher, maxWorkers = 2 }) {
    if (!worker || typeof worker.run !== "function") {
      throw new TypeError("worker.run is required");
    }
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
      throw new RangeError("maxWorkers must be a positive integer");
    }

    this.worker = worker;
    this.publisher = publisher;
    this.maxWorkers = maxWorkers;

    this.sources = new Map();
    this.nodes = new Map();
    this.reverse = new Map();

    // Immutable results are keyed by full transitive provenance. visibleCache is
    // only the projection that is valid for the engine's current graph.
    this.resultCache = new Map();
    this.visibleCache = new Map();
    // Preserve the historical public-ish field name used by the fixture.
    this.cache = this.visibleCache;

    // Shared executions are keyed by the same provenance key as resultCache.
    this.inflight = new Map();

    // One scheduler is shared by every build on the engine.
    this.activeWorkers = 0;
    this.waiting = [];

    this.buildCounter = 0;
    this.definitionCounter = 0;
    this.revision = 0;
    this.generations = new Map();

    // Publisher calls are serialized so an older slow external commit cannot
    // race a newer commit and roll the visible published state backwards.
    this.publishTail = Promise.resolve();
    this.latestPublishedBuildId = 0;
  }

  defineSource(id, value) {
    const oldNode = this.nodes.get(id);
    if (oldNode) {
      this._removeReverseEdges(id, oldNode.deps);
      this.nodes.delete(id);
    }

    this.sources.set(id, {
      value,
      identity: ++this.definitionCounter
    });

    this.revision += 1;
    this._invalidateFrom(id);
  }

  defineNode(id, deps, compute) {
    if (!Array.isArray(deps)) throw new TypeError("deps must be an array");
    if (typeof compute !== "function") throw new TypeError("compute must be a function");

    const oldNode = this.nodes.get(id);
    if (oldNode) this._removeReverseEdges(id, oldNode.deps);
    this.sources.delete(id);

    const definition = {
      deps: Object.freeze([...deps]),
      compute,
      identity: ++this.definitionCounter
    };
    this.nodes.set(id, definition);

    for (const dep of definition.deps) {
      let dependents = this.reverse.get(dep);
      if (!dependents) {
        dependents = new Set();
        this.reverse.set(dep, dependents);
      }
      dependents.add(id);
    }

    this.revision += 1;
    this._invalidateFrom(id);
  }

  get(id) {
    if (this.sources.has(id)) return this.sources.get(id).value;
    return this.visibleCache.get(id)?.value;
  }

  _removeReverseEdges(nodeId, deps) {
    for (const dep of deps) {
      const dependents = this.reverse.get(dep);
      if (!dependents) continue;
      dependents.delete(nodeId);
      if (dependents.size === 0) this.reverse.delete(dep);
    }
  }

  _invalidateFrom(id) {
    const pending = [id];
    const seen = new Set();

    while (pending.length > 0) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);

      this.generations.set(current, (this.generations.get(current) ?? 0) + 1);
      this.visibleCache.delete(current);

      for (const dependent of this.reverse.get(current) ?? []) {
        pending.push(dependent);
      }
    }
  }

  _captureSnapshot() {
    return {
      revision: this.revision,
      sources: new Map(this.sources),
      nodes: new Map(this.nodes),
      generations: new Map(this.generations)
    };
  }

  _resolveDescriptor(snapshot, id, memo, stack, path) {
    if (memo.has(id)) return memo.get(id);

    if (stack.has(id)) {
      const start = path.indexOf(id);
      const cycle = [...path.slice(start), id];
      throw new Error(`dependency cycle: ${cycle.join(" -> ")}`);
    }

    const source = snapshot.sources.get(id);
    if (source) {
      const descriptor = Object.freeze({
        kind: "source",
        id,
        value: source.value,
        key: `s:${source.identity}`
      });
      memo.set(id, descriptor);
      return descriptor;
    }

    const node = snapshot.nodes.get(id);
    if (!node) throw new Error(`unknown node: ${id}`);

    stack.add(id);
    path.push(id);
    let deps;
    try {
      deps = node.deps.map((dep) => this._resolveDescriptor(snapshot, dep, memo, stack, path));
    } finally {
      path.pop();
      stack.delete(id);
    }

    const descriptor = Object.freeze({
      kind: "node",
      id,
      deps: Object.freeze(deps),
      compute: node.compute,
      generation: snapshot.generations.get(id) ?? 0,
      key: `n:${node.identity}[${deps.map((dep) => dep.key).join(",")}]`
    });
    memo.set(id, descriptor);
    return descriptor;
  }

  _promoteVisible(descriptor, result) {
    if (descriptor.kind !== "node") return;
    if ((this.generations.get(descriptor.id) ?? 0) !== descriptor.generation) return;

    const current = this.visibleCache.get(descriptor.id);
    if (!current || current.key === descriptor.key) {
      this.visibleCache.set(descriptor.id, {
        key: descriptor.key,
        value: result.value
      });
    }
  }

  _cachedValue(descriptor) {
    if (descriptor.kind === "source") {
      return Promise.resolve({ value: descriptor.value, key: descriptor.key });
    }

    const cached = this.resultCache.get(descriptor.key);
    if (!cached) return null;
    this._promoteVisible(descriptor, cached);
    return Promise.resolve(cached);
  }

  _attachConsumer(entry, token) {
    if (entry.settled || entry.controller.signal.aborted) return false;
    entry.consumers.add(token);
    return true;
  }

  _detachConsumer(entry, token) {
    if (!entry.consumers.delete(token)) return;
    if (entry.consumers.size === 0 && !entry.settled) {
      this._cancelExecution(entry);
    }
  }

  _releaseDependencies(entry) {
    if (entry.dependenciesReleased) return;
    entry.dependenciesReleased = true;
    for (const lease of entry.dependencyLeases) {
      this._detachConsumer(lease.entry, lease.token);
    }
    entry.dependencyLeases.length = 0;
  }

  _cancelExecution(entry) {
    if (entry.settled || entry.controller.signal.aborted) return;
    entry.controller.abort();
    this._releaseDependencies(entry);
    if (this.inflight.get(entry.key) === entry) {
      this.inflight.delete(entry.key);
    }
  }

  _acquire(descriptor, token, buildId) {
    const cached = this._cachedValue(descriptor);
    if (cached) return { promise: cached, entry: null };

    let entry = this.inflight.get(descriptor.key);
    if (entry && (entry.settled || entry.controller.signal.aborted)) {
      if (this.inflight.get(descriptor.key) === entry) this.inflight.delete(descriptor.key);
      entry = null;
    }

    if (!entry) entry = this._createExecution(descriptor, buildId);

    if (!this._attachConsumer(entry, token)) {
      // A zero-consumer execution can be cancelled between lookup and attach.
      // Create a fresh owner instead of joining an already-fenced lifecycle.
      if (this.inflight.get(descriptor.key) === entry) this.inflight.delete(descriptor.key);
      entry = this._createExecution(descriptor, buildId);
      this._attachConsumer(entry, token);
    }

    return { promise: entry.promise, entry };
  }

  _createExecution(descriptor, buildId) {
    const entry = {
      key: descriptor.key,
      descriptor,
      ownerBuildId: buildId,
      controller: new AbortController(),
      consumers: new Set(),
      dependencyLeases: [],
      dependenciesReleased: false,
      settled: false,
      status: "preparing",
      computeStarted: false,
      promise: null
    };

    // Publish the placeholder first. Descriptor resolution already proved the
    // graph acyclic, so recursive dependency acquisition cannot create a cycle.
    this.inflight.set(entry.key, entry);

    const dependencyPromises = descriptor.deps.map((dep, index) => {
      if (dep.kind === "source") {
        return Promise.resolve({ value: dep.value, key: dep.key });
      }

      const depToken = { owner: entry, index };
      const acquired = this._acquire(dep, depToken, buildId);
      if (acquired.entry) {
        entry.dependencyLeases.push({ entry: acquired.entry, token: depToken });
      }
      return acquired.promise;
    });

    entry.promise = Promise.all(dependencyPromises)
      .then((deps) => {
        if (entry.controller.signal.aborted || entry.consumers.size === 0) {
          throw abortError();
        }

        entry.status = "queued";
        return this._runLimited(entry, async () => {
          if (entry.controller.signal.aborted || entry.consumers.size === 0) {
            throw abortError();
          }

          entry.status = "running";
          const guardedCompute = (...inputs) => {
            if (entry.controller.signal.aborted || entry.consumers.size === 0) {
              throw abortError();
            }
            entry.computeStarted = true;
            return descriptor.compute(...inputs);
          };

          const value = await this.worker.run({
            nodeId: descriptor.id,
            inputs: deps.map((dep) => dep.value),
            compute: guardedCompute,
            buildId: entry.ownerBuildId,
            signal: entry.controller.signal
          });

          if (entry.controller.signal.aborted || entry.consumers.size === 0) {
            throw abortError();
          }

          return { value, key: descriptor.key };
        });
      })
      .then((result) => {
        if (!entry.controller.signal.aborted) {
          this.resultCache.set(descriptor.key, result);
          this._promoteVisible(descriptor, result);
        }
        return result;
      })
      .finally(() => {
        entry.settled = true;
        entry.status = "settled";
        this._releaseDependencies(entry);
        if (this.inflight.get(entry.key) === entry) {
          this.inflight.delete(entry.key);
        }
      });

    return entry;
  }

  _runLimited(entry, task) {
    return new Promise((resolve, reject) => {
      const item = {
        entry,
        task,
        resolve,
        reject,
        started: false,
        finished: false,
        aborted: false,
        onAbort: null
      };

      item.onAbort = () => {
        item.aborted = true;
        if (!item.started && !item.finished) {
          item.finished = true;
          reject(abortError());
        }
      };
      entry.controller.signal.addEventListener("abort", item.onAbort, { once: true });

      this.waiting.push(item);
      this._drainWorkers();
    });
  }

  _drainWorkers() {
    while (this.activeWorkers < this.maxWorkers && this.waiting.length > 0) {
      const item = this.waiting.shift();
      if (item.finished || item.aborted || item.entry.controller.signal.aborted || item.entry.consumers.size === 0) {
        if (!item.finished) {
          item.finished = true;
          item.reject(abortError());
        }
        item.entry.controller.signal.removeEventListener("abort", item.onAbort);
        continue;
      }

      item.started = true;
      item.entry.status = "reserved";
      this.activeWorkers += 1;

      Promise.resolve()
        .then(() => {
          // This microtask is the reservation -> invocation boundary. A cancel
          // that lands here can still suppress worker.run entirely.
          if (item.entry.controller.signal.aborted || item.entry.consumers.size === 0) {
            throw abortError();
          }
          return item.task();
        })
        .then(
          (value) => {
            if (!item.finished) {
              item.finished = true;
              item.resolve(value);
            }
          },
          (error) => {
            if (!item.finished) {
              item.finished = true;
              item.reject(error);
            }
          }
        )
        .finally(() => {
          item.entry.controller.signal.removeEventListener("abort", item.onAbort);
          this.activeWorkers -= 1;
          this._drainWorkers();
        });
    }
  }

  _enqueuePublish(task) {
    const result = this.publishTail.then(task, task);
    this.publishTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  _publish(build, artifacts) {
    if (!this.publisher || typeof this.publisher.publish !== "function") {
      throw new Error("publisher not configured");
    }

    return this._enqueuePublish(async () => {
      const validate = () => {
        throwIfAborted(build.signal);
        if (build.snapshot.revision !== this.revision) {
          throw staleBuildError();
        }
        if (build.buildId <= this.latestPublishedBuildId) {
          throw staleBuildError("a newer build has already been published");
        }
      };

      validate();
      const record = { buildId: build.buildId, artifacts };
      // Keep the historical enumerable publisher payload shape intact while
      // giving async publishers an optional commit-time fence.
      Object.defineProperties(record, {
        snapshotRevision: { value: build.snapshot.revision },
        signal: { value: build.signal },
        validate: { value: validate }
      });
      const committed = await this.publisher.publish(record);
      validate();
      this.latestPublishedBuildId = build.buildId;
      return committed;
    });
  }

  async build(targets, { publish = false, signal } = {}) {
    throwIfAborted(signal);

    const buildId = ++this.buildCounter;
    const snapshot = this._captureSnapshot();
    const memo = new Map();

    // Resolve the entire target closure synchronously before starting workers.
    // This provides one logical snapshot and fails cycles/unknown nodes without
    // partially executing another target.
    const descriptors = targets.map((target) =>
      this._resolveDescriptor(snapshot, target, memo, new Set(), [])
    );

    const token = { buildId };
    const ownedEntries = new Set();
    let rejectAbort;
    const abortPromise = new Promise((_, reject) => {
      rejectAbort = reject;
    });
    // Avoid an unhandled rejection if no signal exists and the promise is never raced.
    abortPromise.catch(() => {});

    const onAbort = () => {
      for (const entry of ownedEntries) this._detachConsumer(entry, token);
      rejectAbort(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const build = { buildId, snapshot, signal };

    try {
      const targetPromises = descriptors.map((descriptor) => {
        if (descriptor.kind === "source") {
          return Promise.resolve({ value: descriptor.value, key: descriptor.key });
        }
        const acquired = this._acquire(descriptor, token, buildId);
        if (acquired.entry) ownedEntries.add(acquired.entry);
        return acquired.promise;
      });

      const resultsPromise = Promise.all(targetPromises);
      const results = signal
        ? await Promise.race([resultsPromise, abortPromise])
        : await resultsPromise;

      throwIfAborted(signal);
      const entries = targets.map((target, index) => [target, results[index].value]);
      const artifacts = Object.fromEntries(entries);

      if (publish) {
        await this._publish(build, artifacts);
      }

      throwIfAborted(signal);
      return { buildId, artifacts };
    } finally {
      signal?.removeEventListener("abort", onAbort);
      for (const entry of ownedEntries) this._detachConsumer(entry, token);
    }
  }
}
