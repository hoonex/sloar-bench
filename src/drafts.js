export class DraftStore {
  constructor(saveRemote) {
    this.saveRemote = saveRemote;
    this.local = new Map();
    this.pending = new Map();
    this.versions = new Map();
  }

  get(id) {
    return this.local.get(id) ?? "";
  }

  update(id, text) {
    const version = (this.versions.get(id) ?? 0) + 1;
    this.versions.set(id, version);
    this.local.set(id, text);

    const previous = this.pending.get(id) ?? Promise.resolve();
    const save = previous.then(
      () => this.saveRemote(id, text),
      () => this.saveRemote(id, text)
    ).then((saved) => {
      // Do not let an older acknowledgement overwrite newer local input.
      if (this.versions.get(id) === version) {
        this.local.set(id, saved.text);
      }
      return saved;
    });

    this.pending.set(id, save);
    const clearPending = () => {
      if (this.pending.get(id) === save) {
        this.pending.delete(id);
      }
    };
    save.then(clearPending, clearPending);

    return save;
  }
}
