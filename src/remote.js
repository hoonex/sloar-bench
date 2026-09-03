export function createRemoteSaver(delays = []) {
  let call = 0;
  const remote = new Map();

  const save = (id, text) => {
    const delay = delays[call++] ?? 0;
    return new Promise((resolve) => {
      setTimeout(() => {
        remote.set(id, text);
        resolve({ id, text });
      }, delay);
    });
  };

  save.read = (id) => remote.get(id) ?? "";
  return save;
}
