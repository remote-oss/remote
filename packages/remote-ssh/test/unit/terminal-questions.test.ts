import {deepStrictEqual} from 'node:assert';
import type {TerminalLogin} from 'lib-ssh';
import type {
  PickRequest,
  PromptEditor,
} from '../../src/surfaces/prompt-surface.ts';
import {attachTerminalQuestions} from '../../src/surfaces/terminal-questions.ts';

const FIRST_CONTACT_TEXT = [
  "Warning: Permanently added 'box (192.0.2.1)' (ED25519) to the list of known hosts.",
  "The authenticity of host 'box (192.0.2.1)' can't be established.",
  'ED25519 key fingerprint is: SHA256:abcdef.',
  'Are you sure you want to continue connecting (yes/no/[fingerprint])?',
].join('\n');

const PASSWORD_TEXT = "alex@dev's password: ";

/** One scripted answer: the value a question gets, or no answer until its signal ends it. */
interface Scripted {
  value: string | undefined;
}

/** What the editor was asked to show. */
interface ShownRequest {
  kind: 'pick' | 'input';
  request: PickRequest | {placeholder: string};
  signal: AbortSignal;
}

/** An editor whose answers come from a script, one per question, so a test never waits on a person. */
class ScriptedEditor implements PromptEditor {
  readonly shown: ShownRequest[] = [];
  private readonly scripts: Scripted[];
  private readonly failsToShow: boolean;

  translate = (template: string): string => `<${template}>`;

  constructor(scripts: Scripted[], failsToShow: boolean) {
    this.scripts = scripts;
    this.failsToShow = failsToShow;
  }

  pick(
    request: PickRequest,
    cancellation: AbortSignal,
  ): Promise<'yes' | 'no' | undefined> {
    return this.answer('pick', request, cancellation) as Promise<
      'yes' | 'no' | undefined
    >;
  }

  maskedInput(
    request: {placeholder: string},
    cancellation: AbortSignal,
  ): Promise<string | undefined> {
    return this.answer('input', request, cancellation);
  }

  private answer(
    kind: ShownRequest['kind'],
    request: ShownRequest['request'],
    cancellation: AbortSignal,
  ): Promise<string | undefined> {
    if (this.failsToShow) {
      return Promise.reject(new Error('the editor could not show it'));
    }
    this.shown.push({kind, request, signal: cancellation});
    const scripted = this.scripts.shift();
    if (scripted === undefined) {
      return new Promise<string | undefined>(resolve => {
        cancellation.addEventListener('abort', () => {
          resolve(undefined);
        });
      });
    }
    return Promise.resolve(scripted.value);
  }
}

/** One login terminal under test, with the handle the surface returns and what it sent. */
interface Setup {
  onQuestion: (text: string) => void;
  dispose: () => void;
  editor: ScriptedEditor;
  sent: string[];
  events: string[];
}

function setup(scripts: Scripted[] = [], failsToShow = false): Setup {
  const editor = new ScriptedEditor(scripts, failsToShow);
  const sent: string[] = [];
  const events: string[] = [];
  const login: TerminalLogin = {
    terminal: {
      send: text => {
        sent.push(text);
        events.push(`send ${text}`);
      },
    },
    reader: {
      inputOpened: () => {
        events.push('inputOpened');
      },
      inputClosed: () => {
        events.push('inputClosed');
      },
    },
  };
  const handle = attachTerminalQuestions(login, editor, 'box');
  return {
    onQuestion: text => {
      handle.onQuestion(text);
    },
    dispose: () => {
      handle.dispose();
    },
    editor,
    sent,
    events,
  };
}

/** Waits until `seen` holds, polling on the next turns of the event loop. */
async function until(seen: () => boolean): Promise<void> {
  for (;;) {
    if (seen()) {
      return;
    }
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
}

describe('the login terminal questions: shown to the user', () => {
  it('F-2306 BR-2: a password question is shown with shared mode placeholder', async () => {
    const context = setup([{value: 'secret'}]);
    context.onQuestion(PASSWORD_TEXT);
    await until(() => context.editor.shown.length === 1);
    deepStrictEqual(
      [context.editor.shown[0]?.kind, context.editor.shown[0]?.request],
      ['input', {placeholder: '<Enter password for alex@dev>'}],
    );
  });

  it('F-2308 BR-6: the answer goes back to the terminal with a carriage return', async () => {
    const context = setup([{value: 'secret'}]);
    context.onQuestion(PASSWORD_TEXT);
    await until(() => context.events.length === 3);
    deepStrictEqual(context.events, [
      'inputOpened',
      'send secret\r',
      'inputClosed',
    ]);
  });

  it('F-2305 BR-2: a host key pick is shown and yes goes to the terminal', async () => {
    const context = setup([{value: 'yes'}]);
    context.onQuestion(FIRST_CONTACT_TEXT);
    await until(() => context.sent.length === 1);
    deepStrictEqual(
      [context.editor.shown[0]?.request, context.sent],
      [
        {
          title: '<"box" has fingerprint "SHA256:abcdef".>',
          placeholder: '<Are you sure you want to continue?>',
          items: [
            {label: '<Continue>', answer: 'yes'},
            {label: '<Cancel>', answer: 'no'},
          ],
        },
        ['yes\r'],
      ],
    );
  });

  it('F-2305 BR-2: a host key pick no goes to the terminal', async () => {
    const context = setup([{value: 'no'}]);
    context.onQuestion(FIRST_CONTACT_TEXT);
    await until(() => context.sent.length === 1);
    deepStrictEqual(
      [context.editor.shown[0]?.kind, context.sent],
      ['pick', ['no\r']],
    );
  });

  it('F-2306 AC-20: a dismissed password prompt sends an empty line and closes its input', async () => {
    const context = setup([{value: undefined}]);
    context.onQuestion(PASSWORD_TEXT);
    await until(() => context.sent.length === 1);
    deepStrictEqual(
      [context.sent, context.events],
      [['\r'], ['inputOpened', 'send \r', 'inputClosed']],
    );
  });

  it('F-2306 AC-20: questions after a dismissal are answered without an input', async () => {
    const context = setup([{value: undefined}]);
    context.onQuestion(PASSWORD_TEXT);
    context.onQuestion(PASSWORD_TEXT);
    context.onQuestion(PASSWORD_TEXT);
    await until(() => context.sent.length === 3);
    deepStrictEqual(
      [context.editor.shown.length, context.sent, context.events],
      [
        1,
        ['\r', '\r', '\r'],
        [
          'inputOpened',
          'send \r',
          'inputClosed',
          'inputOpened',
          'send \r',
          'inputClosed',
          'inputOpened',
          'send \r',
          'inputClosed',
        ],
      ],
    );
  });

  it('F-2306 AC-20: a dismissed host key question sends no', async () => {
    const context = setup([{value: undefined}]);
    context.onQuestion(FIRST_CONTACT_TEXT);
    await until(() => context.sent.length === 1);
    deepStrictEqual(
      [context.sent, context.events],
      [['no\r'], ['inputOpened', 'send no\r', 'inputClosed']],
    );
  });

  it('athena on #352: an editor that cannot show the question sends an empty line and closes its input', async () => {
    const context = setup([], true);
    context.onQuestion(PASSWORD_TEXT);
    await until(() => context.sent.length === 1);
    deepStrictEqual(
      [context.editor.shown, context.sent, context.events],
      [[], ['\r'], ['inputOpened', 'send \r', 'inputClosed']],
    );
  });

  it('athena on #352: two questions back to back are shown one after the other', async () => {
    const context = setup([{value: 'yes'}, {value: 'no'}]);
    context.onQuestion(FIRST_CONTACT_TEXT);
    context.onQuestion(PASSWORD_TEXT);
    await until(() => context.sent.length === 2);
    deepStrictEqual(context.events, [
      'inputOpened',
      'send yes\r',
      'inputClosed',
      'inputOpened',
      'send no\r',
      'inputClosed',
    ]);
  });

  it('contracts: dispose takes the open input down and sends nothing', async () => {
    const context = setup();
    context.onQuestion(PASSWORD_TEXT);
    const shown = context.editor.shown[0];
    context.dispose();
    await until(() => context.events.length === 2);
    deepStrictEqual(
      [shown?.signal.aborted, context.sent, context.events],
      [true, [], ['inputOpened', 'inputClosed']],
    );
  });

  it('contracts: a question after dispose is not shown', async () => {
    const context = setup([{value: 'secret'}]);
    context.dispose();
    context.onQuestion(PASSWORD_TEXT);
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual([context.editor.shown, context.events], [[], []]);
  });

  it('contracts §S7: no log line carries the answer', async () => {
    const context = setup([{value: 'hunter2'}]);
    context.onQuestion(PASSWORD_TEXT);
    await until(() => context.events.length === 3);
    deepStrictEqual(
      context.events.filter(line => line.includes('hunter2')),
      ['send hunter2\r'],
    );
  });
});
