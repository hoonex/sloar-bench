export class Outbox {
  constructor() {
    this.items = [];
    this.flushing = null;
  }

  enqueue(operation) {
    this.items.push(operation);
    return operation;
  }

  pending() {
    return [...this.items];
  }

  flush(send) {
    if (this.flushing) return this.flushing;

    const run = (async () => {
      while (this.items.length > 0) {
        const operation = this.items[0];
        await send(operation);
        if (this.items[0] === operation) {
          this.items.shift();
        }
      }
    })();

    this.flushing = run;
    run.then(
      () => {
        if (this.flushing !== run) return;
        this.flushing = null;
        if (this.items.length > 0) void this.flush(send).catch(() => {});
      },
      () => {
        if (this.flushing === run) this.flushing = null;
      }
    );
    return run;
  }
}
