/**
 * @fileoverview A quick pick for the rows of the option screens and of the stage that owns them: it records what the
 * screen sets and lets a script play the user.
 */

import type {
  OptionPicker,
  OptionRow,
  QuickInputPorts,
} from '../../src/authoring/option-screens.ts';

/** The Back button of the fakes' title bar. */
export const BACK_BUTTON = {name: 'back'};

/** What a script step does with the screen that was just shown. */
export type Step = (picker: FakeOptionPicker) => void;

/** A quick pick that records what the screen sets and lets a row play the user. */
export class FakeOptionPicker implements OptionPicker {
  items: readonly OptionRow[] = [];
  activeItems: readonly OptionRow[] = [];
  selectedItems: readonly OptionRow[] = [];
  canSelectMany = false;
  title: string | undefined = undefined;
  placeholder: string | undefined = undefined;
  value = '';
  buttons: readonly unknown[] = [];
  matchOnDescription = true;
  ignoreFocusOut = true;
  shown = false;
  hidden = false;
  disposed = false;
  private readonly accepting: Array<() => void> = [];
  private readonly changing: Array<(value: string) => void> = [];
  private readonly triggering: Array<(button: unknown) => void> = [];
  private readonly hiding: Array<() => void> = [];
  /** Records the accept listener. */
  onDidAccept(listener: () => void): void {
    this.accepting.push(listener);
  }
  /** Records the listener of typing. */
  onDidChangeValue(listener: (value: string) => void): void {
    this.changing.push(listener);
  }
  /** Records the listener of the title-bar buttons. */
  onDidTriggerButton(listener: (button: unknown) => void): void {
    this.triggering.push(listener);
  }
  /** Records the hide listener. */
  onDidHide(listener: () => void): void {
    this.hiding.push(listener);
  }
  /** Marks the screen shown. */
  show(): void {
    this.shown = true;
  }
  /** Hides the screen and tells the listeners once. */
  hide(): void {
    if (!this.hidden) {
      this.hidden = true;
      this.hiding.forEach(listener => {
        listener();
      });
    }
  }
  /** Marks the screen disposed. */
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
  /** The user accepts with the rows whose labels are `labels` checked. */
  acceptChecked(labels: readonly string[]): void {
    this.selectedItems = this.items.filter(each => labels.includes(each.label));
    this.press();
  }
  /** The user presses Enter on the focused row. */
  acceptFocused(): void {
    this.selectedItems = this.activeItems;
    this.press();
  }
  /** The user presses Enter with nothing to select. */
  acceptNothing(): void {
    this.selectedItems = [];
    this.press();
  }
  /** The user presses a title-bar button. */
  trigger(button: unknown): void {
    this.triggering.forEach(listener => {
      listener(button);
    });
  }
  /** The labels of the rows shown. */
  labels(): string[] {
    return this.items.map(each => each.label);
  }
  private press(): void {
    this.accepting.forEach(listener => {
      listener();
    });
  }
}

/**
 * The quick input over fakes: each screen the code shows is the next of `steps`, which plays the user on it once it
 * has been shown. The screens made are in `pickers`.
 */
export function scriptedInput(steps: Step[]): {
  ports: Omit<QuickInputPorts, 'translate'>;
  pickers: FakeOptionPicker[];
} {
  const pickers: FakeOptionPicker[] = [];
  return {
    pickers,
    ports: {
      backButton: BACK_BUTTON,
      createQuickPick: () => {
        const picker = new FakeOptionPicker();
        pickers.push(picker);
        const step = steps.shift();
        picker.show = () => {
          picker.shown = true;
          if (step !== undefined) {
            queueMicrotask(() => {
              step(picker);
            });
          }
        };
        return picker;
      },
    },
  };
}

/** The step that accepts the row labelled `label`. */
export function pick(label: string): Step {
  return picker => {
    picker.accept(label);
  };
}

/** The step that types `text` and then accepts the focused row. */
export function typeAndAcceptFocused(text: string): Step {
  return picker => {
    picker.type(text);
    picker.acceptFocused();
  };
}

/** The step that checks the rows labelled `labels` and presses OK. */
export function checking(labels: readonly string[]): Step {
  return picker => {
    picker.acceptChecked(labels);
  };
}

/** The step that presses Back. */
export const PRESS_BACK: Step = picker => {
  picker.trigger(BACK_BUTTON);
};

/** The step that closes the screen without an answer, as Escape does. */
export const PRESS_ESCAPE: Step = picker => {
  picker.hide();
};
