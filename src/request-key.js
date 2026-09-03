function withDefault(value, fallback) {
  return value === undefined ? fallback : value;
}

export function buildQueryKey({ workspaceId, status, sort, page }) {
  return JSON.stringify([
    String(workspaceId),
    withDefault(status, "all"),
    withDefault(sort, "updated"),
    withDefault(page, 1)
  ]);
}
