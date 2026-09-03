export class TaskBoardController {
  constructor(cache) {
    this.cache = cache;
    this.current = [];
    this.requestVersion = 0;
  }

  async show(params) {
    const requestVersion = ++this.requestVersion;
    const result = await this.cache.load(params);

    if (requestVersion === this.requestVersion) {
      this.current = result.items;
    }

    return result.items;
  }

  getVisibleIds() {
    return this.current.map((item) => item.id);
  }
}
