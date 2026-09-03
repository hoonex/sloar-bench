export class FakeSyncApi {
  constructor() {
    this.docs = new Map();
    this.calls = [];
    this.delays = [];
    this.failures = [];
    this.appliedOps = new Map();
  }

  _key(userId, id) {
    return `${userId}:${id}`;
  }

  seed(userId, id, text, version = 1) {
    this.docs.set(this._key(userId, id), { id, text, version, deleted: false });
  }

  read(userId, id) {
    const value = this.docs.get(this._key(userId, id));
    return value ? { ...value } : null;
  }

  queueDelay(ms) {
    this.delays.push(ms);
  }

  failNext(mode = "before") {
    this.failures.push(mode);
  }

  async _wait() {
    const delay = this.delays.shift() ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async fetchDoc({ userId, id }) {
    this.calls.push({ type: "fetch", userId, id });
    await this._wait();
    const value = this.read(userId, id);
    return value ? { ...value } : null;
  }

  async mutate(operation) {
    this.calls.push({ type: "mutate", ...operation });
    await this._wait();

    if (this.appliedOps.has(operation.opId)) {
      return { ...this.appliedOps.get(operation.opId) };
    }

    const failure = this.failures.shift();
    if (failure === "before") {
      throw new Error("temporary failure before apply");
    }

    const key = this._key(operation.userId, operation.id);
    const current = this.docs.get(key) ?? {
      id: operation.id,
      text: "",
      version: 0,
      deleted: false
    };

    const next = operation.type === "delete"
      ? { ...current, deleted: true, version: current.version + 1 }
      : { ...current, text: operation.text, deleted: false, version: current.version + 1 };

    this.docs.set(key, next);
    this.appliedOps.set(operation.opId, next);

    if (failure === "after") {
      throw new Error("temporary failure after apply");
    }

    return { ...next };
  }
}
