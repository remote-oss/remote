/**
 * @fileoverview The quick pick the stages of the wizard share: the members of the editor's quick pick they use, and a
 * pick that ends when a row is accepted or the pick is hidden.
 */

/** The members of the editor's quick pick the stages use, over their rows. */
export interface QuickPicker<Item> {
  items: readonly Item[];
  activeItems: readonly Item[];
  readonly selectedItems: readonly Item[];
  title: string | undefined;
  placeholder: string | undefined;
  value: string;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  ignoreFocusOut: boolean;
  onDidAccept(listener: () => void): unknown;
  onDidChangeValue(listener: (value: string) => void): unknown;
  onDidHide(listener: () => void): unknown;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** A pick that ends when a row is accepted or the pick is hidden, which gives `cancelled`. */
export function shownPick<Item, Outcome extends {kind: string}>(
  createQuickPick: () => QuickPicker<Item>,
  cancellation: AbortSignal,
  setUp: (
    picker: QuickPicker<Item>,
    finish: (outcome: Outcome | {kind: 'cancelled'}) => void,
  ) => void,
): Promise<Outcome | {kind: 'cancelled'}> {
  return new Promise(resolve => {
    const picker = createQuickPick();
    let finished = false;
    function finish(outcome: Outcome | {kind: 'cancelled'}): void {
      if (!finished) {
        finished = true;
        resolve(outcome);
        picker.hide();
      }
    }
    picker.matchOnDescription = false;
    picker.matchOnDetail = false;
    picker.ignoreFocusOut = false;
    setUp(picker, finish);
    picker.onDidHide(() => {
      finished = true;
      resolve({kind: 'cancelled'});
      picker.dispose();
    });
    cancellation.addEventListener('abort', () => {
      finish({kind: 'cancelled'});
    });
    picker.show();
  });
}
