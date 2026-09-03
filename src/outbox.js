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

    const drain = async () => {
      while (this.items.length > 0) {
        const operation = this.items[0];
        await send(operation);
        if (this.items[0] === operation) {
          this.items.shift();
        }
      }
    };

    const promise = drain().finally(() => {
      if (this.flushing === promise) {
        this.flushing = null;
      }
    });
    this.flushing = promise;
    return promise;
  }
}
