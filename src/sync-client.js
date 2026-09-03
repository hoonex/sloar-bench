import { entityKey, userKeyPrefix } from "./entity-key.js";
import { ReadCache } from "./read-cache.js";
import { Outbox } from "./outbox.js";
import { Session } from "./session.js";

let clientCounter = 0;

function makeClientId() {
  clientCounter += 1;
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${clientCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class SyncClient {
  constructor(api) {
    this.api = api;
    this.session = new Session();
    this.cache = new ReadCache();
    this.outbox = new Outbox();
    this.local = new Map();
    this.authoritative = new Map();
    this.versions = new Map();
    this.deletedVersions = new Map();
    this.revisions = new Map();
    this.userGenerations = new Map();
    this.keyGenerations = new Map();
    this.operationMeta = new WeakMap();
    this.online = true;
    this.opCounter = 0;
    this.clientId = makeClientId();
  }

  _userGeneration(userId) {
    return this.userGenerations.get(String(userId)) ?? 0;
  }

  _bumpUserGeneration(userId) {
    const normalized = String(userId);
    const next = this._userGeneration(normalized) + 1;
    this.userGenerations.set(normalized, next);
    return next;
  }

  _keyGeneration(key) {
    return this.keyGenerations.get(key) ?? 0;
  }

  _bumpKeyGeneration(key) {
    const next = this._keyGeneration(key) + 1;
    this.keyGenerations.set(key, next);
    return next;
  }

  _revision(key) {
    return this.revisions.get(key) ?? 0;
  }

  _touch(key) {
    const next = this._revision(key) + 1;
    this.revisions.set(key, next);
    return next;
  }

  _metaCurrent(operation, meta = this.operationMeta.get(operation)) {
    if (!meta) return false;
    const key = entityKey(operation.userId, operation.id);
    return this._userGeneration(operation.userId) === meta.userGeneration
      && this._keyGeneration(key) === meta.keyGeneration;
  }

  _pendingFor(userId, id) {
    const normalizedUser = String(userId);
    const normalizedId = String(id);
    return this.outbox.pending().filter((operation) => {
      if (String(operation.userId) !== normalizedUser || String(operation.id) !== normalizedId) {
        return false;
      }
      const meta = this.operationMeta.get(operation);
      return meta?.status !== "acked" && this._metaCurrent(operation, meta);
    });
  }

  _recompute(userId, id) {
    const key = entityKey(userId, id);
    const pending = this._pendingFor(userId, id);
    const hasBase = this.authoritative.has(key) || this.cache.has(userId, id);

    if (!hasBase && pending.length === 0) {
      this.local.delete(key);
      return null;
    }

    let value = this.authoritative.has(key)
      ? this.authoritative.get(key)
      : this.cache.get(userId, id);
    const version = this.versions.get(key) ?? value?.version ?? 0;

    for (const operation of pending) {
      if (operation.type === "delete") {
        value = null;
      } else {
        value = {
          id: operation.id,
          text: operation.text,
          deleted: false,
          version
        };
      }
    }

    this.local.set(key, value);
    return value;
  }

  _wouldAcceptAuthoritative(userId, id, rawValue) {
    const key = entityKey(userId, id);
    const incomingVersion = Number.isFinite(rawValue?.version) ? rawValue.version : 0;
    const knownVersion = this.versions.get(key);
    const deletedVersion = this.deletedVersions.get(key);
    const incomingDeleted = rawValue === null || rawValue?.deleted === true;

    if (knownVersion !== undefined && incomingVersion < knownVersion) return false;
    if (!incomingDeleted && deletedVersion !== undefined && incomingVersion <= deletedVersion) return false;
    if (knownVersion !== undefined && incomingVersion === knownVersion && this.authoritative.has(key)) {
      return false;
    }
    return true;
  }

  _acceptAuthoritative(userId, id, rawValue) {
    if (!this._wouldAcceptAuthoritative(userId, id, rawValue)) return false;

    const key = entityKey(userId, id);
    const incomingVersion = Number.isFinite(rawValue?.version) ? rawValue.version : 0;
    const deletedVersion = this.deletedVersions.get(key);
    const incomingDeleted = rawValue === null || rawValue?.deleted === true;
    const value = incomingDeleted ? null : {
      ...rawValue,
      id: rawValue?.id ?? id,
      deleted: false,
      version: incomingVersion
    };

    this.versions.set(key, incomingVersion);
    if (incomingDeleted) {
      this.deletedVersions.set(key, Math.max(deletedVersion ?? -1, incomingVersion));
    }
    this.authoritative.set(key, value);
    this.cache.set(userId, id, value);
    this._touch(key);
    return true;
  }

  _invalidateUserState(userId) {
    const prefix = userKeyPrefix(userId);
    this._bumpUserGeneration(userId);
    this.cache.invalidateUser(userId);

    for (const key of this.local.keys()) {
      if (key.startsWith(prefix)) this.local.delete(key);
    }
    for (const key of this.authoritative.keys()) {
      if (key.startsWith(prefix)) this.authoritative.delete(key);
    }
  }

  switchUser(userId) {
    return this.session.switchUser(userId);
  }

  logout() {
    const previous = this.session.logout();
    if (previous !== null) this._invalidateUserState(previous);
  }

  invalidate(id) {
    const userId = this.session.userId;
    if (userId === null) return;

    const key = entityKey(userId, id);
    this._bumpKeyGeneration(key);
    this.cache.invalidate(userId, id);
    this.local.delete(key);
    this.authoritative.delete(key);
    this._touch(key);
  }

  invalidateUser(userId = this.session.userId) {
    if (userId === null) return;
    this._invalidateUserState(String(userId));
  }

  setOnline(online) {
    this.online = Boolean(online);
  }

  get(id) {
    const userId = this.session.userId;
    if (userId === null) return null;
    const key = entityKey(userId, id);
    if (this.local.has(key)) return this.local.get(key);
    if (this.cache.has(userId, id)) return this.cache.get(userId, id);
    return null;
  }

  async load(id) {
    const snapshot = this.session.snapshot();
    const userId = snapshot.userId;
    if (userId === null) throw new Error("not signed in");

    const key = entityKey(userId, id);
    if (this._pendingFor(userId, id).length > 0 && this.local.has(key)) {
      return this.local.get(key);
    }

    const userGeneration = this._userGeneration(userId);
    const keyGeneration = this._keyGeneration(key);
    const revision = this._revision(key);
    const cacheToken = this.cache.token(userId, id);
    const isStillValid = (loaded) =>
      this.session.userId === userId
      && this.session.epoch === snapshot.epoch
      && this._userGeneration(userId) === userGeneration
      && this._keyGeneration(key) === keyGeneration
      && this._revision(key) === revision
      && this.cache.isTokenCurrent(cacheToken)
      && this._wouldAcceptAuthoritative(userId, id, loaded);

    const value = await this.cache.load(
      userId,
      id,
      () => this.api.fetchDoc({ userId, id }),
      { shouldStore: isStillValid }
    );

    const sameSession = this.session.userId === userId && this.session.epoch === snapshot.epoch;
    if (!sameSession) return value;
    if (!isStillValid(value)) return this.get(id);

    this._acceptAuthoritative(userId, id, value);
    this._recompute(userId, id);
    return this.get(id);
  }

  _newOperation(type, userId, id, extra = {}) {
    const key = entityKey(userId, id);
    const operation = {
      opId: `${this.clientId}:${++this.opCounter}`,
      type,
      userId,
      id,
      ...extra
    };
    this.operationMeta.set(operation, {
      userGeneration: this._userGeneration(userId),
      keyGeneration: this._keyGeneration(key),
      status: "pending"
    });
    this.outbox.enqueue(operation);
    return operation;
  }

  edit(id, text) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = entityKey(userId, id);
    const previous = this.get(id);
    this._newOperation("edit", userId, id, { text, previous });
    this.cache.supersede(userId, id);
    this._touch(key);
    const optimistic = this._recompute(userId, id);
    if (this.online) void this.flush().catch(() => {});
    return optimistic;
  }

  remove(id) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = entityKey(userId, id);
    const previous = this.get(id);
    this._newOperation("delete", userId, id, { previous });
    this.cache.supersede(userId, id);
    this._touch(key);
    this._recompute(userId, id);
  }

  flush() {
    if (!this.online) return Promise.resolve();

    return this.outbox.flush(async (operation) => {
      if (!this.online) return false;

      const meta = this.operationMeta.get(operation);
      try {
        const saved = await this.api.mutate(operation);
        if (meta) meta.status = "acked";

        if (this._metaCurrent(operation, meta)) {
          this._acceptAuthoritative(operation.userId, operation.id, saved);
          this._recompute(operation.userId, operation.id);
        }
        return saved;
      } catch (error) {
        if (this._metaCurrent(operation, meta)) {
          this._recompute(operation.userId, operation.id);
        }
        throw error;
      }
    });
  }

  reconnect() {
    this.online = true;
    return this.flush();
  }

  applyPush(event) {
    const userId = this.session.userId;
    if (userId === null || String(event.userId) !== userId) return;

    if (this._acceptAuthoritative(userId, event.id, event)) {
      this._recompute(userId, event.id);
    }
  }
}
