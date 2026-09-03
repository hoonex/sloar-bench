export class HistoryEditor {
  constructor(initialText = "") {
    this.text = initialText;
  }

  getText() {
    return this.text;
  }

  setText(nextText) {
    this.text = nextText;
    return this.text;
  }
}
