export class DraftStore {
  constructor(saveRemote) {
    this.saveRemote = saveRemote;
    this.local = new Map();
  }

  get(id) {
    return this.local.get(id) ?? "";
  }

  update(id, text) {
    this.local.set(id, text);

    return this.saveRemote(id, text).then((saved) => {
      // Keep local state aligned with what the server confirms.
      this.local.set(id, saved.text);
      return saved;
    });
  }
}
