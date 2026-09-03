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

    this.flushing = (async () => {
      while (this.items.length > 0) {
        const operation = this.items[0];
        await send(operation);
        this.items.shift();
      }
    })();

    return this.flushing;
  }
}
