export function createTaskApi() {
  const calls = [];
  const failures = new Set();

  const fetchPage = async ({ workspaceId, status = "all", sort = "updated", page = 1 }) => {
    calls.push({ workspaceId, status, sort, page });

    const failureKey = `${workspaceId}:${status}:${sort}:${page}`;
    if (failures.has(failureKey)) {
      failures.delete(failureKey);
      throw new Error(`temporary failure for ${failureKey}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2));
    return {
      items: [
        { id: `${workspaceId}-${status}-${sort}-p${page}-a` },
        { id: `${workspaceId}-${status}-${sort}-p${page}-b` }
      ]
    };
  };

  fetchPage.calls = calls;
  fetchPage.failNext = (params) => {
    const { workspaceId, status = "all", sort = "updated", page = 1 } = params;
    failures.add(`${workspaceId}:${status}:${sort}:${page}`);
  };

  return fetchPage;
}
