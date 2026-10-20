import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {FakeQuickPick, FakeWidget} from './editor-fakes.fixture.ts';
import {platformPickOf} from '../../src/connect/platform-picker.ts';
import {mitigationPickOf} from '../../src/surfaces/mitigation-picker.ts';
import {
  downloadProgressOf,
  failureDialogOf,
  licenceDialogOf,
  mitigationPickPortOf,
  noticeOf,
  platformPickPortOf,
  promptEditorOf,
  textInputOf,
} from '../../src/surfaces/editor-adapters.ts';

type Editor = Pick<typeof vscode, 'window'>;

/** An input box the test drives: what the adapter set on it, and what the test types. */
class FakeInputBox extends FakeWidget {
  password: boolean | undefined;
  value = '';

  accept(typed: string): void {
    this.value = typed;
    this.accepted();
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
  const boxes: FakeInputBox[] = [];
  const inputs: Array<{
    title: string | undefined;
    prompt: string | undefined;
    placeholder: string | undefined;
    typed: string | undefined;
  }> = [];
  const errors: Shown[] = [];
  const warnings: Shown[] = [];
  const infos: Shown[] = [];
  function messageIn(record: Shown[]) {
    return (
      text: string,
      optionsOrItem: vscode.MessageOptions | string | undefined,
      ...items: Array<vscode.MessageItem | string>
    ): Promise<vscode.MessageItem | string | undefined> => {
      const modal = typeof optionsOrItem === 'object';
      const shown: Shown = {
        text,
        options: modal ? optionsOrItem : {},
        items: modal
          ? items
          : [optionsOrItem, ...items].filter(
              (item): item is string => typeof item === 'string',
            ),
      };
      record.push(shown);
      const offered = modal ? items : shown.items;
      const chosen = answer(shown);
      if (chosen === undefined) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(
        offered.find(item =>
          typeof item === 'string' ? item === chosen : item.title === chosen,
        ),
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
      createInputBox: () => {
        const inputBox = new FakeInputBox();
        boxes.push(inputBox);
        return inputBox;
      },
      showInputBox: (options: vscode.InputBoxOptions) => {
        const typed = answer({
          text: options.prompt ?? options.placeHolder ?? '',
          options: {},
          items: [],
        });
        inputs.push({
          title: options.title,
          prompt: options.prompt,
          placeholder: options.placeHolder,
          typed,
        });
        return Promise.resolve(typed);
      },
      showInformationMessage: messageIn(infos),
      showWarningMessage: messageIn(warnings),
      showErrorMessage: messageIn(errors),
    },
  } as unknown as Editor;
  return {editor, picks, boxes, inputs, errors, warnings, infos};
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
  it('F-3902 rule 11: shows a modal information message with the detail and the extension’s one item, and no close affordance', async () => {
    const fake = fakeEditor(() => undefined);
    await licenceDialogOf(fake.editor).showModal('m', 'd', [
      'Accept and Continue',
    ]);
    const shown = fake.infos[0];
    deepStrictEqual(
      [
        shown?.text,
        shown?.options,
        shown?.items.map(item =>
          typeof item === 'string'
            ? item
            : [item.title, item.isCloseAffordance],
        ),
        fake.warnings.length,
      ],
      [
        'm',
        {modal: true, detail: 'd'},
        [['Accept and Continue', undefined]],
        0,
      ],
    );
  });

  it('F-3902 rule 11: resolves the title of the chosen item', async () => {
    const fake = fakeEditor(() => 'Accept and Continue');
    deepStrictEqual(
      await licenceDialogOf(fake.editor).showModal('m', 'd', [
        'Accept and Continue',
      ]),
      'Accept and Continue',
    );
  });

  it('F-3902 rule 11: resolves nothing for the editor’s Cancel', async () => {
    const fake = fakeEditor(() => undefined);
    deepStrictEqual(
      await licenceDialogOf(fake.editor).showModal('m', 'd', [
        'Accept and Continue',
      ]),
      undefined,
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

  it('F-2206 AC-2: the item the pick names as active is the one focused', () => {
    const fake = fakeEditor(() => undefined);
    void platformPickPortOf(fake.editor, same).pick(
      {...platformPickOf('box'), active: 'windows'},
      NEVER,
    );
    deepStrictEqual(
      fake.picks[0]?.activeItems.map(item => item.label),
      ['Windows'],
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
        active: 'linux',
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

describe('promptEditorOf (the login questions, F-2305 and F-2306)', () => {
  const NEVER = new AbortController().signal;
  const REQUEST = {
    title: 'Continue?',
    placeholder: 'Choose',
    items: [
      {label: 'Yes', answer: 'yes' as const},
      {label: 'No', answer: 'no' as const},
    ],
  };

  function asked(
    fake: ReturnType<typeof fakeEditor>,
    controller?: AbortController,
  ) {
    const result = promptEditorOf(fake.editor, same).pick(
      REQUEST,
      controller?.signal ?? NEVER,
    );
    const [pick] = fake.picks;
    if (pick === undefined) {
      throw new Error('no quick pick was created');
    }
    return {result, pick};
  }

  function typedInto(
    fake: ReturnType<typeof fakeEditor>,
    controller?: AbortController,
  ) {
    const result = promptEditorOf(fake.editor, same).maskedInput(
      {placeholder: 'Password: '},
      controller?.signal ?? NEVER,
    );
    const [inputBox] = fake.boxes;
    if (inputBox === undefined) {
      throw new Error('no input box was created');
    }
    return {result, inputBox};
  }

  it('F-2305 BR-5: the pick closes when the user looks away', () => {
    const {pick} = asked(fakeEditor(() => undefined));
    deepStrictEqual([pick.ignoreFocusOut, pick.canSelectMany], [false, false]);
  });

  it('F-2305: the title, the placeholder and the items are shown in order, the first active', () => {
    const {pick} = asked(fakeEditor(() => undefined));
    deepStrictEqual(
      [
        pick.title,
        pick.placeholder,
        pick.items.map(item => item.label),
        pick.activeItems.map(item => item.label),
      ],
      ['Continue?', 'Choose', ['Yes', 'No'], ['Yes']],
    );
  });

  it('F-2305: a pick without a title has none', () => {
    const fake = fakeEditor(() => undefined);
    void promptEditorOf(fake.editor, same).pick(
      {placeholder: 'Choose', items: REQUEST.items},
      NEVER,
    );
    deepStrictEqual(fake.picks[0]?.title, undefined);
  });

  it('F-2305 BR-4: the item taken gives its answer', async () => {
    const {result, pick} = asked(fakeEditor(() => undefined));
    const second = pick.items[1];
    if (second === undefined) {
      throw new Error('no second item');
    }
    pick.accept(second);
    deepStrictEqual(await result, 'no');
  });

  it('F-2305 BR-4: a choice not among the items gives nothing', async () => {
    const {result, pick} = asked(fakeEditor(() => undefined));
    pick.accept({label: 'Other'});
    deepStrictEqual(await result, undefined);
  });

  it('F-2305 BR-4: an accept with no selection gives nothing', async () => {
    const {result, pick} = asked(fakeEditor(() => undefined));
    pick.acceptNothing();
    deepStrictEqual(await result, undefined);
  });

  it('F-2305 BR-5: a pick hidden without a choice gives nothing', async () => {
    const {result, pick} = asked(fakeEditor(() => undefined));
    pick.hide();
    deepStrictEqual(await result, undefined);
  });

  it('contracts: a cancellation hides the pick and gives nothing', async () => {
    const controller = new AbortController();
    const {result, pick} = asked(
      fakeEditor(() => undefined),
      controller,
    );
    controller.abort();
    deepStrictEqual([await result, pick.hides], [undefined, 1]);
  });

  it('contracts: a cancellation that aborted before the pick shows nothing', async () => {
    const fake = fakeEditor(() => undefined);
    const controller = new AbortController();
    controller.abort();
    const result = promptEditorOf(fake.editor, same).pick(
      REQUEST,
      controller.signal,
    );
    deepStrictEqual([await result, fake.picks.length], [undefined, 0]);
  });

  it('F-2305 AC-2, AC-7: the input is masked and stays open when the user looks away (F-2306)', () => {
    const {inputBox} = typedInto(fakeEditor(() => undefined));
    deepStrictEqual(
      [
        inputBox.password,
        inputBox.ignoreFocusOut,
        inputBox.placeholder,
        inputBox.title,
        inputBox.shown,
      ],
      [true, true, 'Password: ', undefined, 1],
    );
  });

  it('F-2306: the typed text is the answer', async () => {
    const {result, inputBox} = typedInto(fakeEditor(() => undefined));
    inputBox.accept('secret');
    deepStrictEqual(await result, 'secret');
  });

  it('F-2306: an input hidden without being accepted gives nothing', async () => {
    const {result, inputBox} = typedInto(fakeEditor(() => undefined));
    inputBox.hide();
    deepStrictEqual(await result, undefined);
  });

  it('contracts: a cancellation hides the input, gives nothing and disposes it', async () => {
    const controller = new AbortController();
    const {result, inputBox} = typedInto(
      fakeEditor(() => undefined),
      controller,
    );
    controller.abort();
    deepStrictEqual(
      [await result, inputBox.hides, inputBox.disposals],
      [undefined, 1, 1],
    );
  });

  it('contracts: a cancellation that aborted before the input shows nothing', async () => {
    const fake = fakeEditor(() => undefined);
    const controller = new AbortController();
    controller.abort();
    const result = promptEditorOf(fake.editor, same).maskedInput(
      {placeholder: 'Password: '},
      controller.signal,
    );
    deepStrictEqual([await result, fake.boxes.length], [undefined, 0]);
  });

  it('contracts: the input is disposed after an answer', async () => {
    const {result, inputBox} = typedInto(fakeEditor(() => undefined));
    inputBox.accept('secret');
    await result;
    deepStrictEqual(inputBox.disposals, 1);
  });

  it('F-3902 rule 8: the translation is the one the adapter was given', () => {
    const fake = fakeEditor(() => undefined);
    deepStrictEqual(
      promptEditorOf(fake.editor, template => `<${template}>`).translate('x'),
      '<x>',
    );
  });
});

describe("the editor's server download notification", () => {
  /** An editor whose progress notifications are recorded; `late` holds each task until the test runs it. */
  function progressEditor(late = false) {
    const events: string[] = [];
    const tasks: Array<() => void> = [];
    let done = 0;
    const editor = {
      ProgressLocation: {Notification: 15},
      window: {
        withProgress: (
          options: vscode.ProgressOptions,
          task: (
            progress: vscode.Progress<{increment?: number}>,
          ) => Thenable<void>,
        ) => {
          events.push(
            `open ${JSON.stringify(options.location)} ${options.title ?? ''} ${String(options.cancellable)}`,
          );
          function start(): void {
            void task({
              report: value => events.push(`step ${String(value.increment)}`),
            }).then(() => {
              done += 1;
            });
          }
          if (late) {
            tasks.push(start);
          } else {
            start();
          }
          return Promise.resolve();
        },
      },
    } as unknown as Pick<typeof vscode, 'window' | 'ProgressLocation'>;
    return {editor, events, tasks, finished: () => done};
  }

  /** Lets the task's promise settle. */
  async function settled(): Promise<void> {
    await new Promise(resolve => {
      setImmediate(resolve);
    });
  }

  it('F-2103 5.0 step 6: the notification opens with its title and no cancel', () => {
    const {editor, events} = progressEditor();
    downloadProgressOf(editor).show('Downloading VS Code Server...');
    deepStrictEqual(events, ['open 15 Downloading VS Code Server... false']);
  });

  it('F-2103 5.0 step 6: the bar moves by the difference to each new percentage', () => {
    const {editor, events} = progressEditor();
    const shown = downloadProgressOf(editor).show('S045');
    shown.report(2);
    shown.report(100);
    deepStrictEqual(events.slice(1), ['step 2', 'step 98']);
  });

  it('F-2103 5.0 step 6: a lower percentage moves nothing', () => {
    const {editor, events} = progressEditor();
    const shown = downloadProgressOf(editor).show('S045');
    shown.report(50);
    shown.report(40);
    deepStrictEqual(events.slice(1), ['step 50']);
  });

  it('F-2103 5.0 step 6: a percentage reported before the editor runs the task is shown when it does', () => {
    const {editor, events, tasks} = progressEditor(true);
    const shown = downloadProgressOf(editor).show('S045');
    shown.report(30);
    for (const start of tasks) {
      start();
    }
    deepStrictEqual(events.slice(1), ['step 30']);
  });

  it('§6: closing it ends the notification', async () => {
    const {editor, finished} = progressEditor();
    downloadProgressOf(editor).show('S045').close();
    await settled();
    deepStrictEqual(finished(), 1);
  });

  it('§6: it stays until it is closed', async () => {
    const {editor, finished} = progressEditor();
    downloadProgressOf(editor).show('S045').report(100);
    await settled();
    deepStrictEqual(finished(), 0);
  });
});

describe('textInputOf and noticeOf (card tooling-24)', () => {
  it('card tooling-24: the text input gets the request, and the typed text is the answer', async () => {
    const fake = fakeEditor(() => 'the-command');
    deepStrictEqual(
      [
        await textInputOf(fake.editor).showInputBox({
          prompt: 'Enter SSH Connection Command',
          placeholder: 'a host',
        }),
        fake.inputs,
      ],
      [
        'the-command',
        [
          {
            title: undefined,
            prompt: 'Enter SSH Connection Command',
            placeholder: 'a host',
            typed: 'the-command',
          },
        ],
      ],
    );
  });

  it('card connect-22: the text input passes the request title to the editor', async () => {
    const fake = fakeEditor(() => undefined);
    await textInputOf(fake.editor).showInputBox({
      title: 'Enter SSH Connection Command',
    });
    deepStrictEqual(
      fake.inputs.map(input => input.title),
      ['Enter SSH Connection Command'],
    );
  });

  it('card tooling-24: a text input with no request and no typed text gives nothing', async () => {
    const fake = fakeEditor(() => undefined);
    deepStrictEqual(
      [await textInputOf(fake.editor).showInputBox({}), fake.inputs],
      [
        undefined,
        [
          {
            title: undefined,
            prompt: undefined,
            placeholder: undefined,
            typed: undefined,
          },
        ],
      ],
    );
  });

  it('card tooling-24: the notices are non-modal, and the one answered gives its button', async () => {
    const fake = fakeEditor(shown =>
      shown.text === 'Host added' ? 'OK' : undefined,
    );
    const notice = noticeOf(fake.editor);
    deepStrictEqual(
      [
        await Promise.all([
          notice.showInformation('Host added', ['OK', 'Dismiss']),
          notice.showWarning('Slow', ['Dismiss']),
          notice.showError('Broken', ['OK']),
        ]),
        fake.infos,
      ],
      [
        ['OK', undefined, undefined],
        [{text: 'Host added', options: {}, items: ['OK', 'Dismiss']}],
      ],
    );
  });
});
