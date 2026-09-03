export function entityKey(userId, id) {
  return JSON.stringify([String(userId), String(id)]);
}
