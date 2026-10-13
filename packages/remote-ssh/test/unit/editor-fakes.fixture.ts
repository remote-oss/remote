/**
 * @fileoverview Fakes of the editor's quick pick and of what it shares with an input box, for the tests of the adapters
 * that drive them: what the adapter set on them, and the events a test fires.
 */

/** An item of a quick pick, as the adapters set it. */
export interface FakeItem {
  label: string;
  description?: string;
  alwaysShow?: boolean;
}

/** What a quick pick and an input box share: the events the editor fires and the calls the adapter makes. */
export class FakeWidget {
  ignoreFocusOut: boolean | undefined;
  placeholder: string | undefined;
  title: string | undefined;
  shown = 0;
  hides = 0;
  disposals = 0;
  private readonly accepts: Array<() => void> = [];
  private readonly hidings: Array<() => void> = [];

  /** Registers a listener for the user accepting. */
  onDidAccept(listener: () => void): {dispose(): void} {
    this.accepts.push(listener);
    return {dispose: () => undefined};
  }

  /** Registers a listener for the widget being hidden. */
  onDidHide(listener: () => void): {dispose(): void} {
    this.hidings.push(listener);
    return {dispose: () => undefined};
  }

  /** The adapter shows the widget. */
  show(): void {
    this.shown += 1;
  }

  /** The widget is hidden, by the adapter or by the user; the listeners hear it. */
  hide(): void {
    this.hides += 1;
    for (const listener of this.hidings) {
      listener();
    }
  }

  /** The adapter is done with the widget. */
  dispose(): void {
    this.disposals += 1;
  }

  /** The user accepts: the listeners hear it. */
  protected accepted(): void {
    for (const listener of this.accepts) {
      listener();
    }
  }
}

/** A quick pick the test drives: what the adapter set on it, and the choice the test makes. */
export class FakeQuickPick extends FakeWidget {
  items: FakeItem[] = [];
  /** Every time the adapter set the focus, each with whether the pick was already shown. */
  readonly focusSets: boolean[] = [];
  private focused: FakeItem[] = [];
  selectedItems: FakeItem[] = [];
  canSelectMany: boolean | undefined;

  /** The items the adapter focused last. */
  get activeItems(): FakeItem[] {
    return this.focused;
  }

  /** The adapter focuses items; the call is noted with whether the pick was shown. */
  set activeItems(items: FakeItem[]) {
    this.focusSets.push(this.shown > 0);
    this.focused = items;
  }

  /** The user accepts `item`. */
  accept(item: FakeItem): void {
    this.selectedItems = [item];
    this.accepted();
  }

  /** The user accepts without a selection. */
  acceptNothing(): void {
    this.accepted();
  }
}
