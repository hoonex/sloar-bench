export class Session {
  constructor() {
    this.userId = null;
    this.epoch = 0;
  }

  switchUser(userId) {
    this.userId = String(userId);
    this.epoch += 1;
    return this.userId;
  }

  logout() {
    const previous = this.userId;
    this.userId = null;
    this.epoch += 1;
    return previous;
  }

  snapshot() {
    return { userId: this.userId, epoch: this.epoch };
  }
}
