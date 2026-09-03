export class DraftStore {
  constructor(saveRemote) {
    this.saveRemote = saveRemote;
    this.local = new Map();
    this.revisions = new Map();
  }

  get(id) {
    return this.local.get(id) ?? "";
  }

  update(id, text) {
    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    this.local.set(id, text);

    return this.saveRemote(id, text).then((saved) => {
      // Ignore stale confirmations from older saves for the same draft.
      if (this.revisions.get(id) === revision) {
        this.local.set(id, saved.text);
      }
      return saved;
    });
  }
}
