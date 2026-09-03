function encodePart(value) {
  const text = String(value);
  return `${text.length}:${text}`;
}

export function entityKey(userId, id) {
  return `${encodePart(userId)}|${encodePart(id)}`;
}

export function userKeyPrefix(userId) {
  return `${encodePart(userId)}|`;
}
