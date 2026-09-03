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
    this.activeByGroup = new Map();
    this.executionCounter = 0;
    this.submissionCounter = 0;

    this.drainWaiters = new Set();
    this.drainCheckScheduled = false;
  }

  submit(task, runner) {
    const normalizedTask = { priority: 0, group: "default", input: {}, ...task };
    const key = taskKey(normalizedTask);
    let execution = this.jobs.get(key);
    let isNew = false;

    if (!execution || execution.terminal) {
      execution = {
        key,
        task: normalizedTask,
        runner,
        attempt: 0,
        state: "queued",
        terminal: false,
        cancelled: false,
        slotHeld: false,
        callers: new Set(),
        controller: new AbortController(),
        executionId: `${key}:${++this.executionCounter}`,
        sequence: ++this.submissionCounter
      };
      this.jobs.set(key, execution);
      isNew = true;
    }

    const handle = this._addCaller(execution);

    if (isNew) {
      this.queue.push(execution);
      this._pump();
    }

    return handle;
  }

  _addCaller(execution) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const caller = { resolve, reject, settled: false };
    execution.callers.add(caller);

    return {
      promise,
      cancel: () => this._cancelCaller(execution, caller)
    };
  }

  _cancelCaller(execution, caller) {
    if (caller.settled) return;

    caller.settled = true;
    execution.callers.delete(caller);
    caller.reject(new CancelledError());

    if (!execution.terminal && execution.callers.size === 0) {
      this._cancelExecution(execution);
    }
  }

  _cancelExecution(execution) {
    execution.terminal = true;
    execution.cancelled = true;

    if (this.jobs.get(execution.key) === execution) {
      this.jobs.delete(execution.key);
    }

    if (execution.state === "queued") {
      const index = this.queue.indexOf(execution);
      if (index >= 0) this.queue.splice(index, 1);
      execution.state = "cancelled";
    } else if (execution.slotHeld) {
      execution.state = "cancelling";
      execution.controller.abort();
    } else {
      execution.state = "cancelled";
    }

    this._pump();
  }

  _pump() {
    this.queue = this.queue.filter(
      (execution) => !execution.terminal && execution.state === "queued"
    );

    while (this.active < this.maxConcurrent) {
      const index = this._nextRunnableIndex();
      if (index < 0) break;

      const [execution] = this.queue.splice(index, 1);
      this._reserveSlot(execution);
    }

    this._scheduleDrainCheck();
  }

  _nextRunnableIndex() {
    let bestIndex = -1;
    let bestPriority = -Infinity;
    let bestSequence = Infinity;

    for (let index = 0; index < this.queue.length; index += 1) {
      const execution = this.queue[index];
      if (execution.terminal || execution.state !== "queued") continue;

      const group = this._groupKey(execution.task);
      if ((this.activeByGroup.get(group) ?? 0) >= this.maxPerGroup) continue;

      const numericPriority = Number(execution.task.priority ?? 0);
      const priority = Number.isNaN(numericPriority) ? 0 : numericPriority;
      if (
        bestIndex < 0 ||
        priority > bestPriority ||
        (priority === bestPriority && execution.sequence < bestSequence)
      ) {
        bestIndex = index;
        bestPriority = priority;
        bestSequence = execution.sequence;
      }
    }

    return bestIndex;
  }

  _reserveSlot(execution) {
    const group = this._groupKey(execution.task);
    execution.state = "starting";
    execution.slotHeld = true;
    this.active += 1;
    this.activeByGroup.set(group, (this.activeByGroup.get(group) ?? 0) + 1);

    queueMicrotask(() => {
      void this._runAttempt(execution);
    });
  }

  async _runAttempt(execution) {
    if (execution.terminal) {
      this._releaseSlot(execution);
      execution.state = "cancelled";
      this._pump();
      return;
    }

    execution.state = "running";
    execution.attempt += 1;

    let value;
    let failure;
    let failed = false;

    try {
      value = await execution.runner(execution.task, {
        signal: execution.controller.signal,
        attempt: execution.attempt,
        executionId: execution.executionId
      });
    } catch (error) {
      failed = true;
      failure = error;
    }

    this._releaseSlot(execution);

    if (execution.terminal) {
      execution.state = "cancelled";
      this._pump();
      return;
    }

    if (
      failed &&
      failure?.transient === true &&
      execution.attempt < this.maxAttempts &&
      execution.callers.size > 0
    ) {
      execution.state = "queued";
      this.queue.push(execution);
      this._pump();
      return;
    }

    this._finishExecution(execution, failed, failed ? failure : value);
    this._pump();
  }

  _releaseSlot(execution) {
    if (!execution.slotHeld) return;

    execution.slotHeld = false;
    this.active -= 1;

    const group = this._groupKey(execution.task);
    const next = (this.activeByGroup.get(group) ?? 0) - 1;
    if (next <= 0) this.activeByGroup.delete(group);
    else this.activeByGroup.set(group, next);
  }

  _finishExecution(execution, failed, result) {
    if (execution.terminal) return;

    execution.terminal = true;
    execution.state = failed ? "failed" : "succeeded";

    if (this.jobs.get(execution.key) === execution) {
      this.jobs.delete(execution.key);
    }

    for (const caller of execution.callers) {
      caller.settled = true;
      if (failed) caller.reject(result);
      else caller.resolve(result);
    }
    execution.callers.clear();
  }

  _groupKey(task) {
    return String(task.group ?? "default");
  }

  pending() {
    return this.queue
      .filter((execution) => !execution.terminal && execution.state === "queued")
      .map((execution) => execution.task);
  }

  runningCount() {
    return this.active;
  }

  drain() {
    return new Promise((resolve) => {
      this.drainWaiters.add(resolve);
      this._scheduleDrainCheck();
    });
  }

  _scheduleDrainCheck() {
    if (
      this.drainWaiters.size === 0 ||
      this.drainCheckScheduled ||
      !this._isQuiescent()
    ) {
      return;
    }

    this.drainCheckScheduled = true;
    queueMicrotask(() => {
      this.drainCheckScheduled = false;
      if (!this._isQuiescent()) return;

      const waiters = [...this.drainWaiters];
      this.drainWaiters.clear();
      for (const resolve of waiters) resolve();
    });
  }

  _isQuiescent() {
    return this.active === 0 && this.queue.length === 0;
  }
}
