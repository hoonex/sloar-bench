const MAX_HISTORY = 20;

export class HistoryEditor {
  constructor(initialText = "") {
    this.text = initialText;
    this.past = [];
    this.future = [];
  }

  getText() {
    return this.text;
  }

  setText(nextText) {
    if (nextText === this.text) {
      return this.text;
    }

    this.past.push(this.text);
    if (this.past.length > MAX_HISTORY) {
      this.past.shift();
    }

    this.text = nextText;
    this.future = [];
    return this.text;
  }

  undo() {
    if (this.past.length === 0) {
      return this.text;
    }

    this.future.push(this.text);
    this.text = this.past.pop();
    return this.text;
  }

  redo() {
    if (this.future.length === 0) {
      return this.text;
    }

    this.past.push(this.text);
    this.text = this.future.pop();
    return this.text;
  }
}
