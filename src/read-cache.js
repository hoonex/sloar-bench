import { entityKey } from "./entity-key.js";

export class ReadCache {
  constructor() {
    this.values = new Map();
    this.inflight = new Map();
    this.generations = new Map();
    this.keysByUser = new Map();
  }

  _key(userId, id) {
    const user = String(userId);
    const key = entityKey(user, id);
    let keys = this.keysByUser.get(user);
    if (!keys) {
      keys = new Set();
      this.keysByUser.set(user, keys);
    }
    keys.add(key);
    return key;
  }

  _generation(key) {
    return this.generations.get(key) ?? 0;
  }

  _bumpGeneration(key) {
    this.generations.set(key, this._generation(key) + 1);
  }

  has(userId, id) {
    return this.values.has(this._key(userId, id));
  }

  get(userId, id) {
    return this.values.get(this._key(userId, id));
  }

  set(userId, id, value) {
    const key = this._key(userId, id);
    this._bumpGeneration(key);
    this.inflight.delete(key);
    this.values.set(key, value);
  }

  fence(userId, id) {
    const key = this._key(userId, id);
    this._bumpGeneration(key);
    this.inflight.delete(key);
  }

  load(userId, id, loader) {
    const key = this._key(userId, id);
    if (this.values.has(key)) {
      return Promise.resolve(this.values.get(key));
    }

    const active = this.inflight.get(key);
    if (active) {
      return active.promise;
    }

    const generation = this._generation(key);
    let request;
    request = Promise.resolve()
      .then(loader)
      .then((value) => {
        const current = this.inflight.get(key);
        if (
          this._generation(key) === generation &&
          current?.promise === request
        ) {
          this.values.set(key, value);
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key)?.promise === request) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, { generation, promise: request });
    return request;
  }

  invalidate(userId, id) {
    const key = this._key(userId, id);
    this.values.delete(key);
    this._bumpGeneration(key);
    this.inflight.delete(key);
  }

  invalidateUser(userId) {
    const user = String(userId);
    const keys = this.keysByUser.get(user);
    if (!keys) return;

    for (const key of keys) {
      this.values.delete(key);
      this._bumpGeneration(key);
      this.inflight.delete(key);
    }
    this.keysByUser.delete(user);
  }
}
