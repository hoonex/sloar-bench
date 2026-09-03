import { buildQueryKey } from "./request-key.js";

export class TaskCache {
  constructor(fetchPage) {
    this.fetchPage = fetchPage;
    this.entries = new Map();
  }

  load(params) {
    const key = buildQueryKey(params);
    if (this.entries.has(key)) {
      return this.entries.get(key);
    }

    const request = Promise.resolve().then(() => this.fetchPage(params));
    this.entries.set(key, request);
    return request;
  }

  invalidateWorkspace(workspaceId) {
    this.entries.delete(String(workspaceId));
  }
}
