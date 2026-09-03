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
  }

  switchUser(userId) {
    return this.session.switchUser(userId);
  }

  logout() {
    const previous = this.session.logout();
    if (previous !== null) this.cache.invalidateUser(previous);
  }

  setOnline(online) {
    this.online = Boolean(online);
  }

  get(id) {
    const userId = this.session.userId;
    if (userId === null) return null;
    return this.local.get(entityKey(userId, id)) ?? this.cache.get(userId, id) ?? null;
  }

  async load(id) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const value = await this.cache.load(userId, id, () =>
      this.api.fetchDoc({ userId, id })
    );

    this.local.set(entityKey(userId, id), value);
    return value;
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

    const operation = {
      opId: `${userId}:${id}:${Date.now()}`,
      type: "edit",
      userId,
      id,
      text,
      previous
    };
    this.outbox.enqueue(operation);
    if (this.online) this.flush();
    return optimistic;
  }

  remove(id) {
    const userId = this.session.userId;
    if (userId === null) throw new Error("not signed in");

    const key = entityKey(userId, id);
    const previous = this.get(id);
    this.local.set(key, null);

    const operation = {
      opId: `${userId}:${id}:${Date.now()}`,
      type: "delete",
      userId,
      id,
      previous
    };
    this.outbox.enqueue(operation);
    if (this.online) this.flush();
  }

  flush() {
    if (!this.online) return Promise.resolve();

    return this.outbox.flush(async (operation) => {
      const key = entityKey(operation.userId, operation.id);
      try {
        const saved = await this.api.mutate(operation);
        this.local.set(key, saved.deleted ? null : saved);
        this.cache.set(operation.userId, operation.id, saved.deleted ? null : saved);
        return saved;
      } catch (error) {
        this.local.set(key, operation.previous ?? null);
        throw error;
      }
    });
  }

  reconnect() {
    this.online = true;
    return this.flush();
  }

  applyPush(event) {
    const key = entityKey(event.userId, event.id);
    const value = event.deleted ? null : {
      id: event.id,
      text: event.text,
      version: event.version,
      deleted: false
    };
    this.local.set(key, value);
    this.cache.set(event.userId, event.id, value);
  }
}
