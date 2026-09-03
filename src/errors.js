export class CancelledError extends Error {
  constructor(message = "cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export class TransientError extends Error {
  constructor(message = "transient failure") {
    super(message);
    this.name = "TransientError";
    this.transient = true;
  }
}
