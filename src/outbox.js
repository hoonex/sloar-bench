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
      await Promise.resolve();
      try {
        while (true) {
          while (this.items.length > 0) {
            const operation = this.items[0];
            const result = await send(operation);
            if (result === false) return;
            if (this.items[0] === operation) {
              this.items.shift();
            }
          }

          await Promise.resolve();
          if (this.items.length === 0) return;
        }
      } finally {
        this.flushing = null;
      }
    })();

    this.flushing = run;
    return run;
  }
}
