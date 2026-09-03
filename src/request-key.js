export function buildQueryKey({
  workspaceId,
  status = "all",
  sort = "updated",
  page = 1
}) {
  return JSON.stringify([String(workspaceId), status, sort, page]);
}
