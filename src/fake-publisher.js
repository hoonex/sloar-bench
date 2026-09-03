function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export class FakePublisher {
  constructor() {
    this.calls = [];
    this.commits = [];
    this.delays = [];
    this.failures = [];
  }

  queueDelay(ms) {
    this.delays.push(ms);
  }

  failNext(message = "publish failure") {
    this.failures.push(message);
  }

  async publish(record) {
    this.calls.push({
      buildId: record.buildId,
      artifacts: { ...record.artifacts },
      snapshotRevision: record.snapshotRevision
    });

    const delay = this.delays.shift() ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (record.signal?.aborted) throw abortError();
    record.validate?.();

    const failure = this.failures.shift();
    if (failure) throw new Error(failure);

    const committed = {
      buildId: record.buildId,
      artifacts: { ...record.artifacts }
    };
    this.commits.push(committed);
    return committed;
  }

  latest() {
    return this.commits.at(-1) ?? null;
  }
}
