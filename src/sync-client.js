import { entityKey } from "./entity-key.js";
import { ReadCache } from "./read-cache.js";
import { Outbox } from "./outbox.js";
import { Session } from "./session.js";

export class SyncClient {
  constructor(api) {
    this.api = api;
    this.session = new Session();
    this.cache = new ReadCache();
    this.outbox = new Outbox();
    this.local = new Map();
    this.online = true;
    this.opCounter = 0;
    this.revisionCounter = 0;
    this.entityRevisions = new Map();
    this.serverVersions = new Map();
    this.userEpochs = new Map();
    this.keysByUser = new Map();
    this.clientNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

  _userEpoch(userId) {
    return this.userEpochs.get(String(userId)) ?? 0;
  }

  _bumpUserEpoch(userId) {
    const user = String(userId);
    this.userEpochs.set(user, this._userEpoch(user) + 1);
  }

  _revision(key) {
    return this.entityRevisions.get(key) ?? 0;
  }

  _bumpRevision(key) {
    const revision = ++this.revisionCounter;
    this.entityRevisions.set(key, revision);
    return revision;
  }

  _version(value) {
    const version = Number(value?.version ?? 0);
    return Number.isFinite(version) ? version : 0;
  }

  _knownVersion(key) {
    return this.serverVersions.get(key) ?? 0;
  }

  _recordVersion(key, value) {
    const version = this._version(value);
    if (version > this._knownVersion(key)) {
      this.serverVersions.set(key, version);
    }
    return version;
  }

  _visible(value) {
    if (!value || value.deleted) return null;
    return value;
  }

  _getFor(userId, id) {
    const key = this._key(userId, id);
    if (this.local.has(key)) {
      return this.local.get(key);
    }
    if (this.cache.has(userId, id)) {
      return this._visible(this.cache.get(userId, id));
    }
    return null;
  }

  _hasPendingForKey(key) {
    return this.outbox.pending().some(
      (operation) => entityKey(operation.userId, operation.id) === key
    );
  }

  _invalidateUser(userId) {
    const user = String(userId);
    this._bumpUserEpoch(user);
    this.cache.invalidateUser(user);

    const keys = this.keysByUser.get(user);
    if (!keys) return;
    for (const key of keys) {
      this.local.delete(key);
      this.entityRevisions.delete(key);
      this.serverVersions.delete(key);
    }
    this.keysByUser.delete(user);
  }

  _nextOpId() {
    this.opCounter += 1;
    return `${this.clientNonce}:${this.opCounter}`;
  }

  switchUser(userId) {
    return this.session.switchUser(userId);
  }

  logout() {
    const previous = this.session.logout();
    if (previous !== null) this._invalidateUser(previous);
  }

  setOnline(online) {
    this.online = Boolean(online);
  }

  get(id) {
    const userId = this.session.userId;
    if (userId === null) return null;
    return this._getFor(userId, id);
  }

  async load(id) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = this._key(userId, id);
    const userEpoch = this._userEpoch(userId);
    const revision = this._revision(key);
    const value = await this.cache.load(userId, id, () =>
      this.api.fetchDoc({ userId, id })
    );

    if (this._userEpoch(userId) !== userEpoch) {
      return this._visible(value);
    }

    const incomingVersion = this._version(value);
    const knownVersion = this._knownVersion(key);
    if (incomingVersion < knownVersion) {
      return this._getFor(userId, id);
    }

    this._recordVersion(key, value);
    if (
      this._revision(key) === revision &&
      !this._hasPendingForKey(key)
    ) {
      this.local.set(key, this._visible(value));
    }
    return this._visible(value);
  }

  edit(id, text) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = this._key(userId, id);
    const previous = this._getFor(userId, id);
    if (previous) this._recordVersion(key, previous);
    this.cache.fence(userId, id);
    const revision = this._bumpRevision(key);
    const optimistic = {
      id,
      text,
      deleted: false,
      version: this._knownVersion(key)
    };
    this.local.set(key, optimistic);

    const operation = {
      opId: this._nextOpId(),
      type: "edit",
      userId,
      id,
      text,
      previous: previous ? { ...previous } : null,
      revision,
      userEpoch: this._userEpoch(userId)
    };
    this.outbox.enqueue(operation);
    if (this.online) void this.flush().catch(() => {});
    return optimistic;
  }

  remove(id) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = this._key(userId, id);
    const previous = this._getFor(userId, id);
    if (previous) this._recordVersion(key, previous);
    this.cache.fence(userId, id);
    const revision = this._bumpRevision(key);
    this.local.set(key, null);

    const operation = {
      opId: this._nextOpId(),
      type: "delete",
      userId,
      id,
      previous: previous ? { ...previous } : null,
      revision,
      userEpoch: this._userEpoch(userId)
    };
    this.outbox.enqueue(operation);
    if (this.online) void this.flush().catch(() => {});
  }

  flush() {
    if (!this.online) return Promise.resolve();

    return this.outbox.flush(async (operation) => {
      const key = this._key(operation.userId, operation.id);
      try {
        const { revision: _revision, userEpoch: _userEpoch, ...request } = operation;
        const saved = await this.api.mutate(request);
        if (this._userEpoch(operation.userId) !== operation.userEpoch) {
          return saved;
        }

        const savedVersion = this._version(saved);
        const knownVersion = this._knownVersion(key);
        if (savedVersion >= knownVersion) {
          this._recordVersion(key, saved);
          this.cache.set(operation.userId, operation.id, saved);
          if (this._revision(key) === operation.revision) {
            this.local.set(key, this._visible(saved));
          }
        } else if (
          this._revision(key) === operation.revision &&
          this.cache.has(operation.userId, operation.id)
        ) {
          this.local.set(
            key,
            this._visible(this.cache.get(operation.userId, operation.id))
          );
        }
        return saved;
      } catch (error) {
        if (
          this._userEpoch(operation.userId) === operation.userEpoch &&
          this._revision(key) === operation.revision
        ) {
          const rollback = this.cache.has(operation.userId, operation.id)
            ? this._visible(this.cache.get(operation.userId, operation.id))
            : operation.previous ?? null;
          this.local.set(key, rollback);
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
    const currentUser = this.session.userId;
    if (currentUser === null || String(event.userId) !== currentUser) {
      return false;
    }

    const key = this._key(event.userId, event.id);
    const incomingVersion = this._version(event);
    if (incomingVersion <= this._knownVersion(key)) {
      return false;
    }

    const value = {
      id: event.id,
      text: event.text,
      version: incomingVersion,
      deleted: Boolean(event.deleted)
    };
    this.serverVersions.set(key, incomingVersion);
    this.cache.set(event.userId, event.id, value);

    if (!this._hasPendingForKey(key)) {
      this.local.set(key, this._visible(value));
    }
    return true;
  }
}
