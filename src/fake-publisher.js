export class FakePublisher {
  constructor() {
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
    const delay = this.delays.shift() ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

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
