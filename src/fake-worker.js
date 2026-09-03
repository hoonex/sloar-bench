function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export class FakeWorker {
  constructor() {
    this.calls = [];
    this.delays = [];
    this.failures = [];
    this.active = 0;
    this.maxActive = 0;
  }

  queueDelay(ms) {
    this.delays.push(ms);
  }

  failNext(message = "worker failure") {
    this.failures.push(message);
  }

  async run({ nodeId, inputs, compute, buildId, signal }) {
    this.calls.push({ nodeId, inputs: [...inputs], buildId });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);

    try {
      const delay = this.delays.shift() ?? 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (signal?.aborted) throw abortError();

      const failure = this.failures.shift();
      if (failure) throw new Error(failure);

      return await compute(...inputs);
    } finally {
      this.active -= 1;
    }
  }
}
