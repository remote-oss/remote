/**
 * @fileoverview What the fake quick picks of the authoring rows share: the rows shown, the listeners the code under test
 * registers, and the user's typing and accepting.
 */

/** A quick pick that records what the code under test sets and lets a row play the user. */
export class FakeQuickPick<Item extends {label: string}> {
  items: readonly Item[] = [];
  activeItems: readonly Item[] = [];
  selectedItems: readonly Item[] = [];
  title: string | undefined = undefined;
  placeholder: string | undefined = undefined;
  value = '';
  matchOnDescription = true;
  ignoreFocusOut = true;
  shown = false;
  hidden = false;
  disposed = false;
  private readonly accepting: Array<() => void> = [];
  private readonly changing: Array<(value: string) => void> = [];
  private readonly hiding: Array<() => void> = [];
  /** Records the accept listener. */
  onDidAccept(listener: () => void): void {
    this.accepting.push(listener);
  }
  /** Records the listener of typing. */
  onDidChangeValue(listener: (value: string) => void): void {
    this.changing.push(listener);
  }
  /** Records the hide listener. */
  onDidHide(listener: () => void): void {
    this.hiding.push(listener);
  }
  /** Marks the pick shown. */
  show(): void {
    this.shown = true;
  }
  /** Hides the pick and tells the listeners once. */
  hide(): void {
    if (!this.hidden) {
      this.hidden = true;
      this.hiding.forEach(listener => {
        listener();
      });
    }
  }
  /** Marks the pick disposed. */
  dispose(): void {
    this.disposed = true;
  }
  /** The user types `value`. */
  type(value: string): void {
    this.value = value;
    this.changing.forEach(listener => {
      listener(value);
    });
  }
  /** The user accepts the row with `label`: it becomes the only selected one. */
  accept(label: string): void {
    const found = this.items.find(each => each.label === label);
    this.selectedItems = found === undefined ? [] : [found];
    this.press();
  }
  /** Tells the accept listeners. */
  protected press(): void {
    this.accepting.forEach(listener => {
      listener();
    });
  }
}
