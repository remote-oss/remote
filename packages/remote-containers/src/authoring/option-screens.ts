/**
 * @fileoverview The screens that ask for the value of an option, over a quick pick the caller's port makes: one screen
 * for the value of a string option, with the default tagged and, unless the option is an enum, a row for text the user
 * typed; and one multi-select screen for a set of booleans. Both have a Back button and no bottom button but the
 * multi-select's OK. They touch no file and know no template: the stage that owns an option's meaning builds the screen.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';

/** The English template of each text of the screens, by its string id. */
const SCREEN_TEMPLATES = {
  S015: '(custom)',
  S016: '(default)',
  S392: 'Use: {0}',
} as const;

/** A row of an option screen. */
export interface OptionRow {
  label: string;
  description?: string;
  /** Shown whatever the user typed, as the row for typed text is. */
  alwaysShow?: boolean;
  /** The value the row stands for: a listed value, the typed text of the custom row, or a boolean's key. */
  value: string;
  /** The row that stands for the text the user typed. */
  custom?: true;
  /** The editor's icon beside the label. */
  iconPath?: unknown;
}

/** The members of the editor's quick pick the screens use. */
export interface OptionPicker {
  items: readonly OptionRow[];
  activeItems: readonly OptionRow[];
  /** The checked rows of a multi-select, which the screen sets before it shows and the editor keeps current. */
  selectedItems: readonly OptionRow[];
  canSelectMany: boolean;
  title: string | undefined;
  placeholder: string | undefined;
  value: string;
  buttons: readonly unknown[];
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  ignoreFocusOut: boolean;
  onDidAccept(listener: () => void): unknown;
  onDidChangeValue(listener: (value: string) => void): unknown;
  onDidTriggerButton(listener: (button: unknown) => void): unknown;
  onDidHide(listener: () => void): unknown;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** What the screens need of their surroundings. */
export interface QuickInputPorts {
  createQuickPick(): OptionPicker;
  /** The editor's Back button of a quick input's title bar. */
  backButton: unknown;
  /** The title-bar button that finishes the wizard with the defaults, on the screens that have one. */
  finishButton: unknown;
  /** The editor's icon that marks a verified owner. */
  verifiedIcon: unknown;
  translate: Translate;
}

/** A screen for the value of one string option. */
export interface ValueScreen {
  title: string;
  /** The option's description, or the fallback text when it has none. */
  placeholder: string;
  values: readonly string[];
  defaultValue?: string;
  /** True for an enum: the screen only filters and offers no row for typed text. */
  strict: boolean;
  /** True on a template's screens: the default is listed first. */
  defaultFirst: boolean;
  /** A Feature's screens only: a button that finishes the walk. */
  finishButton: boolean;
  /** True for a choice between two actions: the screen has no title-bar button. */
  bare?: true;
}

/** What a value screen ends with. */
export type ValueAnswer =
  | {kind: 'value'; value: string}
  | {kind: 'back'}
  | {kind: 'escape'}
  /** `value` is the focused item's, or the typed text; empty when nothing is focused. */
  | {kind: 'finish'; value: string};

/** One boolean of a multi-select screen. */
interface BooleanItem {
  key: string;
  label: string;
  description?: string;
  checked: boolean;
  /** Carries the verified icon. */
  verified?: boolean;
}

/** A screen for the booleans of a template or a Feature, all at once. */
export interface BooleanScreen {
  title: string;
  placeholder: string;
  items: readonly BooleanItem[];
  /** True on Select Features: a title-bar button that finishes the wizard with what is checked. */
  finishButton?: true;
  /** True for a screen that stays open when the focus leaves it. */
  keepOpen?: true;
  /** True for a screen that starts with no row focused. */
  unfocused?: true;
}

/** What a boolean screen ends with. */
export type BooleanAnswer =
  | {kind: 'values'; checked: ReadonlySet<string>}
  | {kind: 'finish'; checked: ReadonlySet<string>}
  | {kind: 'back'}
  | {kind: 'escape'};

function text(
  ports: QuickInputPorts,
  name: keyof typeof SCREEN_TEMPLATES,
  values: readonly string[] = [],
): string {
  return filled(ports.translate, SCREEN_TEMPLATES[name], values);
}

/** The title-bar buttons of a screen: none for a bare one, Back, and Finish where the screen has an answer for it. */
function titleButtonsOf(
  ports: QuickInputPorts,
  ends: {finishing?: unknown; bare?: true},
): unknown[] {
  if (ends.bare === true) {
    return [];
  }
  return ends.finishing === undefined
    ? [ports.backButton]
    : [ports.backButton, ports.finishButton];
}

/** A screen that ends when its answer is given, Back is pressed or it is hidden. */
function shown<Answer extends {kind: string}>(
  ports: QuickInputPorts,
  cancellation: AbortSignal,
  ends: {
    escape: Answer;
    back: Answer;
    /** The answer of the title-bar Finish button, from what the screen holds when it is pressed. */
    finishing?: (picker: OptionPicker) => Answer;
    /** True for a screen with no title-bar button at all. */
    bare?: true;
  },
  setUp: (picker: OptionPicker, finish: (answer: Answer) => void) => void,
): Promise<Answer> {
  return new Promise(resolve => {
    const picker = ports.createQuickPick();
    let finished = false;
    function finish(answer: Answer): void {
      if (!finished) {
        finished = true;
        resolve(answer);
        picker.hide();
      }
    }
    picker.matchOnDescription = false;
    picker.matchOnDetail = false;
    picker.ignoreFocusOut = false;
    picker.buttons = titleButtonsOf(ports, ends);
    picker.onDidTriggerButton(button => {
      if (button === ports.backButton) {
        finish(ends.back);
      } else if (ends.finishing !== undefined) {
        finish(ends.finishing(picker));
      }
    });
    setUp(picker, finish);
    picker.onDidHide(() => {
      if (!finished) {
        finished = true;
        resolve(ends.escape);
      }
      picker.dispose();
    });
    cancellation.addEventListener('abort', () => {
      finish(ends.escape);
    });
    picker.show();
  });
}

/** The rows of the listed values: the default tagged, and first when the screen says so. */
function valueRows(screen: ValueScreen, ports: QuickInputPorts): OptionRow[] {
  const rows = screen.values.map((value): OptionRow => ({
    label: value,
    ...(value === screen.defaultValue
      ? {description: text(ports, 'S016')}
      : {}),
    value,
  }));
  const tagged = rows.filter(entry => entry.value === screen.defaultValue);
  return screen.defaultFirst
    ? [...tagged, ...rows.filter(entry => entry.value !== screen.defaultValue)]
    : rows;
}

/** Whether a listed value shows for the typed text: the editor's filter, as a plain substring. */
function matches(entry: OptionRow, typed: string): boolean {
  return entry.label.toLowerCase().includes(typed.toLowerCase());
}

/**
 * Asks for the value of a string option. The listed values filter as the user types; a screen that is not strict adds a
 * row for the text typed, after the values, while the text is not exactly one of them, and focuses it only when no
 * value matches. A strict screen keeps itself open when Enter finds no row.
 */
export function pickValue(
  screen: ValueScreen,
  ports: QuickInputPorts,
  cancellation: AbortSignal,
): Promise<ValueAnswer> {
  const listed = valueRows(screen, ports);
  return shown<ValueAnswer>(
    ports,
    cancellation,
    {
      escape: {kind: 'escape'},
      back: {kind: 'back'},
      ...(screen.bare === true ? {bare: true as const} : {}),
      ...(screen.finishButton
        ? {
            finishing: (picker: OptionPicker): ValueAnswer => ({
              kind: 'finish',
              value: picker.activeItems[0]?.value ?? '',
            }),
          }
        : {}),
    },
    (picker, finish) => {
      function show(typed: string): void {
        const showing = listed.filter(entry => matches(entry, typed));
        const customised =
          !screen.strict && typed !== '' && !screen.values.includes(typed);
        const custom: OptionRow[] = customised
          ? [
              {
                label: text(ports, 'S392', [typed]),
                description: text(ports, 'S015'),
                alwaysShow: true,
                value: typed,
                custom: true,
              },
            ]
          : [];
        picker.items = [...listed, ...custom];
        const [first] = showing.length > 0 ? showing : custom;
        picker.activeItems = first === undefined ? [] : [first];
      }
      picker.title = screen.title;
      picker.placeholder = screen.placeholder;
      picker.canSelectMany = false;
      show('');
      picker.onDidChangeValue(show);
      picker.onDidAccept(() => {
        const [selected] = picker.selectedItems;
        if (selected !== undefined) {
          finish({kind: 'value', value: selected.value});
        }
      });
    },
  );
}

/** Asks which of the booleans are set, on one multi-select screen whose items start at their defaults. */
export function pickBooleans(
  screen: BooleanScreen,
  ports: QuickInputPorts,
  cancellation: AbortSignal,
): Promise<BooleanAnswer> {
  return shown<BooleanAnswer>(
    ports,
    cancellation,
    {
      escape: {kind: 'escape'},
      back: {kind: 'back'},
      ...(screen.finishButton === true
        ? {
            finishing: (picker: OptionPicker): BooleanAnswer => ({
              kind: 'finish',
              checked: new Set(picker.selectedItems.map(entry => entry.value)),
            }),
          }
        : {}),
    },
    (picker, finish) => {
      const rows = screen.items.map((item): OptionRow => ({
        label: item.label,
        ...(item.description === undefined
          ? {}
          : {description: item.description}),
        ...(item.verified === true ? {iconPath: ports.verifiedIcon} : {}),
        value: item.key,
      }));
      picker.title = screen.title;
      picker.placeholder = screen.placeholder;
      picker.canSelectMany = true;
      if (screen.keepOpen === true) {
        picker.ignoreFocusOut = true;
      }
      picker.items = rows;
      if (screen.unfocused === true) {
        picker.activeItems = [];
      }
      picker.selectedItems = rows.filter(
        (entry, index) => screen.items[index]?.checked === true,
      );
      picker.onDidAccept(() => {
        finish({
          kind: 'values',
          checked: new Set(picker.selectedItems.map(entry => entry.value)),
        });
      });
    },
  );
}
