export class GraphEngine {
  constructor({ worker, publisher, maxWorkers = 2 }) {
    this.worker = worker;
    this.publisher = publisher;
    this.maxWorkers = maxWorkers;

    this.sources = new Map();
    this.nodes = new Map();
    this.reverse = new Map();
    this.cache = new Map();
    this.inflight = new Map();

    this.activeWorkers = 0;
    this.waiting = [];
    this.buildCounter = 0;
  }

  defineSource(id, value) {
    const current = this.sources.get(id);
    const version = (current?.version ?? 0) + 1;
    this.sources.set(id, { value, version });
    this.cache.delete(id);

    for (const dependent of this.reverse.get(id) ?? []) {
      this.cache.delete(dependent);
    }
  }

  defineNode(id, deps, compute) {
    this.nodes.set(id, { deps: [...deps], compute });
    for (const dep of deps) {
      if (!this.reverse.has(dep)) this.reverse.set(dep, new Set());
      this.reverse.get(dep).add(id);
    }
    this.cache.delete(id);
  }

  get(id) {
    if (this.sources.has(id)) return this.sources.get(id).value;
    return this.cache.get(id)?.value;
  }

  _runLimited(task) {
    return new Promise((resolve, reject) => {
      const start = async () => {
        this.activeWorkers += 1;
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        } finally {
          this.activeWorkers -= 1;
          const next = this.waiting.shift();
          if (next) next();
        }
      };

      if (this.activeWorkers < this.maxWorkers) start();
      else this.waiting.push(start);
    });
  }

  _compute(id, buildId, signal) {
    if (this.sources.has(id)) {
      const source = this.sources.get(id);
      return Promise.resolve({ value: source.value, version: source.version });
    }

    if (this.cache.has(id)) {
      return Promise.resolve(this.cache.get(id));
    }

    if (this.inflight.has(id)) {
      return this.inflight.get(id);
    }

    const node = this.nodes.get(id);
    if (!node) return Promise.reject(new Error(`unknown node: ${id}`));

    const request = Promise.all(
      node.deps.map((dep) => this._compute(dep, buildId, signal))
    ).then((deps) => this._runLimited(async () => {
      const value = await this.worker.run({
        nodeId: id,
        inputs: deps.map((dep) => dep.value),
        compute: node.compute,
        buildId,
        signal
      });

      return {
        value,
        version: Math.max(0, ...deps.map((dep) => dep.version))
      };
    })).then((result) => {
      this.cache.set(id, result);
      this.inflight.delete(id);
      return result;
    });

    this.inflight.set(id, request);
    return request;
  }

  async build(targets, { publish = false, signal } = {}) {
    const buildId = ++this.buildCounter;
    const entries = await Promise.all(
      targets.map(async (target) => [target, (await this._compute(target, buildId, signal)).value])
    );
    const artifacts = Object.fromEntries(entries);

    if (publish) {
      if (!this.publisher) throw new Error("publisher not configured");
      await this.publisher.publish({ buildId, artifacts });
    }

    return { buildId, artifacts };
  }
}
