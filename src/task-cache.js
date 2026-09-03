import { buildQueryKey } from "./request-key.js";

export class TaskCache {
  constructor(fetchPage) {
    this.fetchPage = fetchPage;
    this.entries = new Map();
  }

  load(params) {
    const workspaceId = String(params.workspaceId);
    let workspaceEntries = this.entries.get(workspaceId);

    if (!workspaceEntries) {
      workspaceEntries = new Map();
      this.entries.set(workspaceId, workspaceEntries);
    }

    const key = buildQueryKey(params);
    if (workspaceEntries.has(key)) {
      return workspaceEntries.get(key);
    }

    const request = Promise.resolve().then(() => this.fetchPage(params));
    workspaceEntries.set(key, request);

    request.catch(() => {
      if (workspaceEntries.get(key) !== request) {
        return;
      }

      workspaceEntries.delete(key);
      if (
        workspaceEntries.size === 0 &&
        this.entries.get(workspaceId) === workspaceEntries
      ) {
        this.entries.delete(workspaceId);
      }
    });

    return request;
  }

  invalidateWorkspace(workspaceId) {
    this.entries.delete(String(workspaceId));
  }
}
