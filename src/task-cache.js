import { buildQueryKey } from "./request-key.js";

export class TaskCache {
  constructor(fetchPage) {
    this.fetchPage = fetchPage;
    this.entries = new Map();
    this.workspaceKeys = new Map();
  }

  load(params) {
    const key = buildQueryKey(params);
    if (this.entries.has(key)) {
      return this.entries.get(key);
    }

    const workspaceId = String(params.workspaceId);
    const request = Promise.resolve()
      .then(() => this.fetchPage(params))
      .catch((error) => {
        if (this.entries.get(key) === request) {
          this.entries.delete(key);

          const keys = this.workspaceKeys.get(workspaceId);
          if (keys) {
            keys.delete(key);
            if (keys.size === 0) {
              this.workspaceKeys.delete(workspaceId);
            }
          }
        }

        throw error;
      });

    this.entries.set(key, request);

    let keys = this.workspaceKeys.get(workspaceId);
    if (!keys) {
      keys = new Set();
      this.workspaceKeys.set(workspaceId, keys);
    }
    keys.add(key);

    return request;
  }

  invalidateWorkspace(workspaceId) {
    const normalizedWorkspaceId = String(workspaceId);
    const keys = this.workspaceKeys.get(normalizedWorkspaceId);
    if (!keys) {
      return;
    }

    for (const key of keys) {
      this.entries.delete(key);
    }
    this.workspaceKeys.delete(normalizedWorkspaceId);
  }
}
