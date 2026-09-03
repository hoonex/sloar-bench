import { entityKey, userKeyPrefix } from "./entity-key.js";

export class ReadCache {
  constructor() {
    this.values = new Map();
    this.inflight = new Map();
    this.keyEpochs = new Map();
    this.userEpochs = new Map();
  }

  _userEpoch(userId) {
    return this.userEpochs.get(String(userId)) ?? 0;
  }

  _keyEpoch(key) {
    return this.keyEpochs.get(key) ?? 0;
  }

  token(userId, id) {
    const key = entityKey(userId, id);
    return {
      key,
      userId: String(userId),
      userEpoch: this._userEpoch(userId),
      keyEpoch: this._keyEpoch(key)
    };
  }

  isTokenCurrent(token) {
    return this._userEpoch(token.userId) === token.userEpoch
      && this._keyEpoch(token.key) === token.keyEpoch;
  }

  has(userId, id) {
    return this.values.has(entityKey(userId, id));
  }

  get(userId, id) {
    return this.values.get(entityKey(userId, id));
  }

  set(userId, id, value) {
    this.values.set(entityKey(userId, id), value);
  }

  load(userId, id, loader, { shouldStore } = {}) {
    const key = entityKey(userId, id);
    if (this.values.has(key)) {
      return Promise.resolve(this.values.get(key));
    }
    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const token = this.token(userId, id);
    let request;
    request = Promise.resolve()
      .then(loader)
      .then((value) => {
        const accepted = typeof shouldStore !== "function" || shouldStore(value);
        if (this.isTokenCurrent(token) && accepted) {
          this.values.set(key, value);
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === request) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, request);
    return request;
  }

  invalidate(userId, id) {
    const key = entityKey(userId, id);
    this.values.delete(key);
    this.inflight.delete(key);
    this.keyEpochs.set(key, this._keyEpoch(key) + 1);
  }

  invalidateUser(userId) {
    const normalizedUserId = String(userId);
    const prefix = userKeyPrefix(normalizedUserId);
    this.userEpochs.set(normalizedUserId, this._userEpoch(normalizedUserId) + 1);

    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.values.delete(key);
    }
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
  }
}
