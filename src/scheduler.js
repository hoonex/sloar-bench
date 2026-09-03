import { taskKey } from "./task-key.js";
import { CancelledError } from "./errors.js";

export class TaskScheduler {
  constructor({ maxConcurrent = 2, maxPerGroup = 1, maxAttempts = 2 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxPerGroup = maxPerGroup;
    this.maxAttempts = maxAttempts;
    this.queue = [];
    this.jobs = new Map();
    this.active = 0;
    this.executionCounter = 0;
  }

  submit(task, runner) {
    const key = taskKey(task);
    const existing = this.jobs.get(key);
    if (existing) return existing.handle;

    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const job = {
      key,
      task: { priority: 0, group: "default", input: {}, ...task },
      runner,
      resolve,
      reject,
      promise,
      attempt: 0,
      running: false,
      cancelled: false,
      controller: new AbortController(),
      executionId: `${key}:${++this.executionCounter}`
    };

    const handle = {
      promise,
      cancel: () => this._cancel(job)
    };
    job.handle = handle;

    this.jobs.set(key, job);
    this.queue.push(job);
    this._pump();
    return handle;
  }

  _cancel(job) {
    if (job.cancelled) return;
    job.cancelled = true;
    job.controller.abort();
    job.reject(new CancelledError());

    if (!job.running) {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
      this.jobs.delete(job.key);
      this._pump();
    }
  }

  _pump() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (job.cancelled) continue;
      this._start(job);
    }
  }

  _start(job) {
    job.running = true;
    job.attempt += 1;
    this.active += 1;

    Promise.resolve()
      .then(() => job.runner(job.task, {
        signal: job.controller.signal,
        attempt: job.attempt,
        executionId: job.executionId
      }))
      .then(
        (value) => {
          if (!job.cancelled) job.resolve(value);
        },
        (error) => {
          if (!job.cancelled && error?.transient && job.attempt < this.maxAttempts) {
            job.running = false;
            this.queue.push(job);
            return;
          }
          if (!job.cancelled) job.reject(error);
        }
      )
      .finally(() => {
        this.active -= 1;
        if (!this.queue.includes(job)) {
          job.running = false;
          this.jobs.delete(job.key);
        }
        this._pump();
      });
  }

  pending() {
    return this.queue.map((job) => job.task);
  }

  runningCount() {
    return this.active;
  }

  drain() {
    const promises = [...this.jobs.values()].map((job) =>
      job.promise.catch(() => undefined)
    );
    return Promise.all(promises).then(() => undefined);
  }
}
