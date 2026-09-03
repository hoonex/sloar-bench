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
    this.online = true;
    this.opCounter = 0;
    this.clientId = makeClientId();
    this.latestMutationSeq = new Map();
    this.pendingMutations = new Map();
    this.serverState = new Map();
    this.operationMeta = new WeakMap();
  }

  switchUser(userId) {
    return this.session.switchUser(userId);
  }

  logout() {
    const previous = this.session.logout();
    if (previous !== null) this._invalidateUser(previous);
  }

  invalidate(id) {
    const userId = this.session.userId;
    if (userId === null) return;
    const key = entityKey(userId, id);
    this.cache.invalidate(userId, id);
    this.local.delete(key);
    this.serverState.delete(key);
    this.latestMutationSeq.delete(key);
    this.pendingMutations.delete(key);
  }

  invalidateUser(userId = this.session.userId) {
    if (userId === null) return;
    this._invalidateUser(String(userId));
  }

  _invalidateUser(userId) {
    const prefix = userKeyPrefix(userId);
    this.cache.invalidateUser(userId);
    for (const map of [this.local, this.serverState, this.latestMutationSeq, this.pendingMutations]) {
      for (const key of map.keys()) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }
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

  _pendingCount(key) {
    return this.pendingMutations.get(key) ?? 0;
  }

  _incrementPending(key) {
    this.pendingMutations.set(key, this._pendingCount(key) + 1);
  }

  _decrementPending(key) {
    const count = this._pendingCount(key);
    if (count <= 1) this.pendingMutations.delete(key);
    else this.pendingMutations.set(key, count - 1);
  }

  _remoteVersion(value) {
    const version = value?.version;
    return Number.isFinite(version) ? version : null;
  }

  _normalizedRemote(value) {
    if (value === null || value?.deleted) return null;
    return { ...value, deleted: false };
  }

  _isStaleRemote(key, value) {
    const current = this.serverState.get(key);
    if (!current) return false;

    const version = this._remoteVersion(value);
    if (version === null) return current.version !== null;
    if (current.version === null) return false;
    if (version < current.version) return true;
    if (version === current.version && current.deleted && !value?.deleted) return true;
    return false;
  }

  _recordRemote(userId, id, value, { writeLocal = true } = {}) {
    const key = entityKey(userId, id);
    if (this._isStaleRemote(key, value)) return false;

    const normalized = this._normalizedRemote(value);
    const version = this._remoteVersion(value);
    const current = this.serverState.get(key);
    if (!current || current.version === null || version === null || version >= current.version) {
      this.serverState.set(key, { version, deleted: normalized === null });
    }
    this.cache.set(userId, id, normalized);
    if (writeLocal) this.local.set(key, normalized);
    return true;
  }

  async load(id) {
    const session = this.session.snapshot();
    const { userId } = session;
    if (userId === null) throw new Error("not signed in");

    const key = entityKey(userId, id);
    if (this._pendingCount(key) > 0 && this.local.has(key)) {
      return this.local.get(key);
    }

    const cacheToken = this.cache.token(userId, id);
    const mutationSeq = this.latestMutationSeq.get(key) ?? 0;
    const value = await this.cache.load(
      userId,
      id,
      () => this.api.fetchDoc({ userId, id }),
      {
        shouldStore: (loaded) => {
          const sameSession = this.session.userId === userId && this.session.epoch === session.epoch;
          const sameMutation = (this.latestMutationSeq.get(key) ?? 0) === mutationSeq;
          return sameSession
            && sameMutation
            && this.cache.isTokenCurrent(cacheToken)
            && !this._isStaleRemote(key, loaded);
        }
      }
    );

    const sameSession = this.session.userId === userId && this.session.epoch === session.epoch;
    const sameMutation = (this.latestMutationSeq.get(key) ?? 0) === mutationSeq;
    if (!sameSession || !sameMutation || !this.cache.isTokenCurrent(cacheToken) || this._isStaleRemote(key, value)) {
      if (sameSession) return this.get(id);
      return value;
    }

    this._recordRemote(userId, id, value);
    return this.get(id);
  }

  _newOperation(type, userId, id, extra = {}) {
    const key = entityKey(userId, id);
    const seq = ++this.opCounter;
    const operation = {
      opId: `${this.clientId}:${seq}`,
      type,
      userId,
      id,
      ...extra
    };
    this.operationMeta.set(operation, {
      seq,
      cacheToken: this.cache.token(userId, id)
    });
    this.latestMutationSeq.set(key, seq);
    this._incrementPending(key);
    this.outbox.enqueue(operation);
    return operation;
  }

  edit(id, text) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = entityKey(userId, id);
    const previous = this.get(id);
    const optimistic = {
      id,
      text,
      deleted: false,
      version: previous?.version ?? 0
    };
    this.local.set(key, optimistic);
    this._newOperation("edit", userId, id, { text, previous });
    if (this.online) void this.flush().catch(() => {});
    return optimistic;
  }

  remove(id) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = entityKey(userId, id);
    const previous = this.get(id);
    this.local.set(key, null);
    this._newOperation("delete", userId, id, { previous });
    if (this.online) void this.flush().catch(() => {});
  }

  _restoreAuthoritative(operation, key, meta) {
    if (!meta || !this.cache.isTokenCurrent(meta.cacheToken)) return;
    if (this.latestMutationSeq.get(key) !== meta.seq) return;
    if (this.cache.has(operation.userId, operation.id)) {
      this.local.set(key, this.cache.get(operation.userId, operation.id));
    } else {
      this.local.set(key, null);
    }
  }

  flush() {
    if (!this.online) return Promise.resolve();

    return this.outbox.flush(async (operation) => {
      const key = entityKey(operation.userId, operation.id);
      const meta = this.operationMeta.get(operation);
      try {
        const saved = await this.api.mutate(operation);
        const tokenCurrent = Boolean(meta && this.cache.isTokenCurrent(meta.cacheToken));
        let accepted = false;
        if (tokenCurrent) {
          accepted = this._recordRemote(operation.userId, operation.id, saved, { writeLocal: false });
        }

        this._decrementPending(key);
        if (tokenCurrent && this.latestMutationSeq.get(key) === meta.seq && this._pendingCount(key) === 0) {
          if (accepted) {
            this.local.set(key, this._normalizedRemote(saved));
          } else if (this.cache.has(operation.userId, operation.id)) {
            this.local.set(key, this.cache.get(operation.userId, operation.id));
          }
        }
        return saved;
      } catch (error) {
        this._restoreAuthoritative(operation, key, meta);
        throw error;
      }
    });
  }

  reconnect() {
    this.online = true;
    return this.flush();
  }

  applyPush(event) {
    const currentUserId = this.session.userId;
    if (currentUserId === null || String(event.userId) !== currentUserId) return;

    const key = entityKey(currentUserId, event.id);
    const current = this.serverState.get(key);
    const version = this._remoteVersion(event);
    if (current?.version !== null && current?.version !== undefined && version !== null && version <= current.version) {
      return;
    }
    if (this._isStaleRemote(key, event)) return;

    const writeLocal = this._pendingCount(key) === 0;
    this._recordRemote(currentUserId, event.id, event, { writeLocal });
  }
}
