export class HistoryEditor {
  constructor(initialText = "") {
    this.text = initialText;
    this.history = [initialText];
    this.historyIndex = 0;
  }

  getText() {
    return this.text;
  }

  setText(nextText) {
    if (nextText === this.text) {
      return this.text;
    }

    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(nextText);

    if (this.history.length > 21) {
      this.history.splice(1, this.history.length - 21);
    }

    this.historyIndex = this.history.length - 1;
    this.text = nextText;
    return this.text;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex -= 1;
      this.text = this.history[this.historyIndex];
    }

    return this.text;
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.text = this.history[this.historyIndex];
    }

    return this.text;
  }
}
