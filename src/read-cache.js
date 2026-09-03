import { entityKey } from "./entity-key.js";

export class ReadCache {
  constructor() {
    this.values = new Map();
    this.inflight = new Map();
  }

  get(userId, id) {
    return this.values.get(entityKey(userId, id));
  }

  set(userId, id, value) {
    this.values.set(entityKey(userId, id), value);
  }

  load(userId, id, loader) {
    const key = entityKey(userId, id);
    if (this.values.has(key)) {
      return Promise.resolve(this.values.get(key));
    }
    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const request = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.values.set(key, value);
        this.inflight.delete(key);
        return value;
      });

    this.inflight.set(key, request);
    return request;
  }

  invalidate(userId, id) {
    this.values.delete(entityKey(userId, id));
  }

  invalidateUser(userId) {
    for (const key of this.values.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.values.delete(key);
      }
    }
  }
}
