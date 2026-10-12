import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {platformPickOf} from '../../src/connect/platform-picker.ts';
import {mitigationPickOf} from '../../src/surfaces/mitigation-picker.ts';
import {
  failureDialogOf,
  licenceDialogOf,
  mitigationPickPortOf,
  platformPickPortOf,
} from '../../src/surfaces/editor-adapters.ts';

type Editor = Pick<typeof vscode, 'window'>;

interface FakeItem {
  label: string;
}

/** A quick pick the test drives: what the adapter set on it, and the events it fires. */
class FakeQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  items: FakeItem[] = [];
  activeItems: FakeItem[] = [];
  selectedItems: FakeItem[] = [];
  canSelectMany: boolean | undefined;
  ignoreFocusOut: boolean | undefined;
  shown = 0;
  hides = 0;
  disposals = 0;
  private readonly accepts: Array<() => void> = [];
  private readonly hidings: Array<() => void> = [];

  onDidAccept(listener: () => void): {dispose(): void} {
    this.accepts.push(listener);
    return {dispose: () => undefined};
  }

  onDidHide(listener: () => void): {dispose(): void} {
    this.hidings.push(listener);
    return {dispose: () => undefined};
  }

  show(): void {
    this.shown += 1;
  }

  hide(): void {
    this.hides += 1;
    for (const listener of this.hidings) {
      listener();
    }
  }

  dispose(): void {
    this.disposals += 1;
  }

  accept(item: FakeItem): void {
    this.selectedItems = [item];
    for (const listener of this.accepts) {
      listener();
    }
  }
}

/** A message the editor was asked to show, and the item it will answer. */
interface Shown {
  text: string;
  options: vscode.MessageOptions;
  items: Array<vscode.MessageItem | string>;
}

function fakeEditor(answer: (shown: Shown) => string | undefined) {
  const picks: FakeQuickPick[] = [];
  const errors: Shown[] = [];
  const warnings: Shown[] = [];
  function messageIn(record: Shown[]) {
    return (
      text: string,
      options: vscode.MessageOptions,
      ...items: Array<vscode.MessageItem | string>
    ): Promise<vscode.MessageItem | undefined> => {
      const shown = {text, options, items};
      record.push(shown);
      const chosen = answer(shown);
      return Promise.resolve(
        items.find(
          item => typeof item !== 'string' && item.title === chosen,
        ) as vscode.MessageItem | undefined,
      );
    };
  }
  const editor = {
    window: {
      createQuickPick: () => {
        const pick = new FakeQuickPick();
        picks.push(pick);
        return pick;
      },
      showErrorMessage: messageIn(errors),
      showWarningMessage: messageIn(warnings),
    },
  } as unknown as Editor;
  return {editor, picks, errors, warnings};
}

function same(template: string): string {
  return template;
}

describe('failureDialogOf (card remote-ssh-17 table)', () => {
  it('F-2601: shows a modal error whose last button is the close affordance', async () => {
    const fake = fakeEditor(() => undefined);
    await failureDialogOf(fake.editor).showError('t', [
      'Close Remote',
      'Retry',
      'More Actions...',
    ]);
    const shown = fake.errors[0];
    deepStrictEqual(
      [
        shown?.text,
        shown?.options,
        shown?.items.map(item =>
          typeof item === 'string'
            ? item
            : [item.title, item.isCloseAffordance],
        ),
      ],
      [
        't',
        {modal: true},
        [
          ['Close Remote', false],
          ['Retry', false],
          ['More Actions...', true],
        ],
      ],
    );
  });

  it('F-2601: resolves the title of the chosen button', async () => {
    const fake = fakeEditor(() => 'Retry');
    deepStrictEqual(
      await failureDialogOf(fake.editor).showError('t', ['Retry', 'Cancel']),
      'Retry',
    );
  });

  it('F-2601 BR-1: resolves nothing when the dialog is dismissed', async () => {
    const fake = fakeEditor(() => undefined);
    deepStrictEqual(
      await failureDialogOf(fake.editor).showError('t', ['Retry', 'Cancel']),
      undefined,
    );
  });
});

describe('licenceDialogOf (card remote-ssh-17 table)', () => {
  it('F-3902 rule 11: shows a modal warning with the detail and the cancel as close affordance', async () => {
    const fake = fakeEditor(() => undefined);
    await licenceDialogOf(fake.editor).showModal('m', 'd', [
      'Accept and Continue',
      'Cancel',
    ]);
    const shown = fake.warnings[0];
    deepStrictEqual(
      [
        shown?.text,
        shown?.options,
        shown?.items.map(item =>
          typeof item === 'string'
            ? item
            : [item.title, item.isCloseAffordance],
        ),
      ],
      [
        'm',
        {modal: true, detail: 'd'},
        [
          ['Accept and Continue', false],
          ['Cancel', true],
        ],
      ],
    );
  });

  it('F-3902 rule 11: resolves the title of the chosen button', async () => {
    const fake = fakeEditor(() => 'Accept and Continue');
    deepStrictEqual(
      await licenceDialogOf(fake.editor).showModal('m', 'd', [
        'Accept and Continue',
        'Cancel',
      ]),
      'Accept and Continue',
    );
  });
});

describe('platformPickPortOf (card remote-ssh-17 table)', () => {
  const NEVER = new AbortController().signal;

  function shown(
    fake: ReturnType<typeof fakeEditor>,
    controller?: AbortController,
  ) {
    const result = platformPickPortOf(fake.editor, same).pick(
      platformPickOf('box'),
      controller?.signal ?? NEVER,
    );
    const [pick] = fake.picks;
    if (pick === undefined) {
      throw new Error('no quick pick was created');
    }
    return {result, pick};
  }

  it('F-2206 5.2: the placeholder names the host and the items are the three platforms in order', () => {
    const fake = fakeEditor(() => undefined);
    const {pick} = shown(fake);
    deepStrictEqual(
      [pick.placeholder, pick.items.map(item => item.label), pick.title],
      [
        'Select the platform of the remote host "box"',
        ['Linux', 'Windows', 'macOS'],
        undefined,
      ],
    );
  });

  it('F-2206 5.2: the first item is focused, one can be chosen, and it closes when focus is lost', () => {
    const fake = fakeEditor(() => undefined);
    const {pick} = shown(fake);
    deepStrictEqual(
      [
        pick.activeItems.map(item => item.label),
        pick.canSelectMany,
        pick.ignoreFocusOut,
        pick.shown,
      ],
      [['Linux'], false, false, 1],
    );
  });

  it('F-2206: the chosen platform is the answer', async () => {
    const fake = fakeEditor(() => undefined);
    const {result, pick} = shown(fake);
    const windows = pick.items[1];
    if (windows === undefined) {
      throw new Error('no second item');
    }
    pick.accept(windows);
    deepStrictEqual(await result, 'windows');
  });

  it('F-2206 AC-9: a pick hidden without a choice gives nothing', async () => {
    const fake = fakeEditor(() => undefined);
    const {result, pick} = shown(fake);
    pick.hide();
    deepStrictEqual(await result, undefined);
  });

  it('contracts: a cancellation hides the pick and gives nothing', async () => {
    const fake = fakeEditor(() => undefined);
    const controller = new AbortController();
    const {result, pick} = shown(fake, controller);
    controller.abort();
    deepStrictEqual([await result, pick.hides], [undefined, 1]);
  });

  it('contracts: a cancellation that aborted before the pick shows nothing and gives nothing', async () => {
    const fake = fakeEditor(() => undefined);
    const controller = new AbortController();
    controller.abort();
    const result = platformPickPortOf(fake.editor, same).pick(
      platformPickOf('box'),
      controller.signal,
    );
    deepStrictEqual([await result, fake.picks.length], [undefined, 0]);
  });

  it('F-2206: two choices with the same label are told apart by which one was taken', async () => {
    const fake = fakeEditor(() => undefined);
    const result = platformPickPortOf(fake.editor, same).pick(
      {
        placeholder: {id: 'platformPickPlaceholder', values: ['box']},
        items: [
          {label: 'Same', platform: 'linux'},
          {label: 'Same', platform: 'windows'},
        ],
      },
      NEVER,
    );
    const [pick] = fake.picks;
    const second = pick?.items[1];
    if (pick === undefined || second === undefined) {
      throw new Error('no second item');
    }
    pick.accept(second);
    deepStrictEqual(await result, 'windows');
  });

  it('contracts: the pick is disposed after an answer', async () => {
    const fake = fakeEditor(() => undefined);
    const {result, pick} = shown(fake);
    const [first] = pick.items;
    if (first === undefined) {
      throw new Error('no first item');
    }
    pick.accept(first);
    await result;
    deepStrictEqual(pick.disposals, 1);
  });
});

describe('mitigationPickPortOf (the "More Actions..." picker, F-2602)', () => {
  function shown(fake: ReturnType<typeof fakeEditor>) {
    const result = mitigationPickPortOf(fake.editor).pick(
      mitigationPickOf(same),
    );
    const [pick] = fake.picks;
    if (pick === undefined) {
      throw new Error('no quick pick was created');
    }
    return {result, pick};
  }

  it('F-2602 AC-2: the placeholder and the five items are shown in order, the first focused', () => {
    const {pick} = shown(fakeEditor(() => undefined));
    const expected = mitigationPickOf(same);
    deepStrictEqual(
      [
        pick.placeholder,
        pick.items.map(item => item.label),
        pick.activeItems.map(item => item.label),
        pick.title,
      ],
      [
        expected.placeholder,
        expected.items.map(item => item.label),
        [expected.items[0]?.label],
        undefined,
      ],
    );
  });

  it('F-2602 §17 Q2: the pick closes when the user looks away', () => {
    const {pick} = shown(fakeEditor(() => undefined));
    deepStrictEqual([pick.ignoreFocusOut, pick.canSelectMany], [false, false]);
  });

  it('F-2602: the item taken gives its action', async () => {
    const {result, pick} = shown(fakeEditor(() => undefined));
    const third = pick.items[2];
    if (third === undefined) {
      throw new Error('no third item');
    }
    pick.accept(third);
    deepStrictEqual(await result, 'openDocumentation');
  });

  it('F-2602: a pick hidden without a choice gives nothing', async () => {
    const {result, pick} = shown(fakeEditor(() => undefined));
    pick.hide();
    deepStrictEqual(await result, undefined);
  });
});
