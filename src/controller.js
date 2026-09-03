export class TaskBoardController {
  constructor(cache) {
    this.cache = cache;
    this.current = [];
  }

  async show(params) {
    const result = await this.cache.load(params);
    this.current = result.items;
    return this.current;
  }

  getVisibleIds() {
    return this.current.map((item) => item.id);
  }
}
