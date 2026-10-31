/**
 * @fileoverview A quick pick for the rows of the option screens and of the stage that owns them: it records what the
 * screen sets and lets a script play the user.
 */

import {FakeQuickPick} from './quick-pick.fixture.ts';
import type {
  OptionPicker,
  OptionRow,
  QuickInputPorts,
} from '../../src/authoring/option-screens.ts';

/** The Back button of the fakes' title bar. */
export const BACK_BUTTON = {name: 'back'};

/** What a script step does with the screen that has been shown. */
export type Step = (picker: FakeOptionPicker) => void;

/** A quick pick that records what the screen sets and lets a row play the user. */
export class FakeOptionPicker
  extends FakeQuickPick<OptionRow>
  implements OptionPicker
{
  canSelectMany = false;
  buttons: readonly unknown[] = [];
  private readonly triggering: Array<(button: unknown) => void> = [];
  /** Records the listener of the title-bar buttons. */
  onDidTriggerButton(listener: (button: unknown) => void): void {
    this.triggering.push(listener);
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
export function pressBack(picker: FakeOptionPicker): void {
  picker.trigger(BACK_BUTTON);
}

/** The step that closes the screen without an answer, as Escape does. */
export function pressEscape(picker: FakeOptionPicker): void {
  picker.hide();
}

/** The step that takes what a screen starts with: the focused row, or the rows already checked. */
export function takeDefaults(picker: FakeOptionPicker): void {
  if (picker.canSelectMany) {
    picker.acceptChecked(picker.selectedItems.map(each => each.label));
  } else {
    picker.acceptFocused();
  }
}

/** The quick input over fakes whose every screen is played by `step`. */
export function repeatedInput(step: Step): Omit<QuickInputPorts, 'translate'> {
  return {
    backButton: BACK_BUTTON,
    createQuickPick: () => {
      const picker = new FakeOptionPicker();
      picker.show = () => {
        picker.shown = true;
        queueMicrotask(() => {
          step(picker);
        });
      };
      return picker;
    },
  };
}
