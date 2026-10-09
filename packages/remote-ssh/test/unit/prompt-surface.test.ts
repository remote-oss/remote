import {deepStrictEqual} from 'node:assert';
import type {ConnectionNotice} from 'lib-ssh';
import {
  attachPromptSurface,
  type PickRequest,
  type PromptEditor,
  type PromptLease,
} from '../../src/surfaces/prompt-surface.ts';

const FINGERPRINT_TEXT = [
  "The authenticity of host 'box (192.0.2.1)' can't be established.",
  'ED25519 key fingerprint is: SHA256:abcdef.',
  'Are you sure you want to continue connecting (yes/no/[fingerprint])?',
].join('\n');

const PASSWORD_TEXT = "user@box's password:";

/** A lease that records the answers and hands the notices the test sends. */
class FakeLease implements PromptLease {
  answers: Array<[number, string]> = [];
  refused: number[] = [];
  listeners = new Set<(notice: ConnectionNotice) => void>();
  refusesAnswers = false;

  onNotice(listener: (notice: ConnectionNotice) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  answer(promptId: number, text: string): Promise<boolean> {
    this.answers.push([promptId, text]);
    return this.refusesAnswers
      ? Promise.reject(new Error('the lease is gone'))
      : Promise.resolve(true);
  }

  refuse(promptId: number): Promise<boolean> {
    this.refused.push(promptId);
    return this.refusesAnswers
      ? Promise.reject(new Error('the lease is gone'))
      : Promise.resolve(true);
  }

  send(notice: ConnectionNotice): void {
    for (const listener of this.listeners) {
      listener(notice);
    }
  }
}

/** What the editor was asked to show, and how to answer it. */
interface Shown {
  kind: 'pick' | 'input';
  request: PickRequest | {placeholder: string};
  finish: (value: string | undefined) => void;
  signal: AbortSignal;
}

/** An editor that shows nothing and lets the test answer what it was asked. */
class FakeEditor implements PromptEditor {
  shown: Shown[] = [];
  waiting: string[] = [];
  waitingTakenDown = 0;

  translate = (template: string): string => `<${template}>`;

  pick(
    request: PickRequest,
    cancellation: AbortSignal,
  ): Promise<'yes' | 'no' | undefined> {
    return this.open('pick', request, cancellation) as Promise<
      'yes' | 'no' | undefined
    >;
  }

  maskedInput(
    request: {placeholder: string},
    cancellation: AbortSignal,
  ): Promise<string | undefined> {
    return this.open('input', request, cancellation);
  }

  showWaiting(text: string): {dispose(): void} {
    this.waiting.push(text);
    return {
      dispose: () => {
        this.waitingTakenDown += 1;
      },
    };
  }

  last(): Shown {
    const shown = this.shown.at(-1);
    if (shown === undefined) {
      throw new Error('nothing was shown');
    }
    return shown;
  }

  private open(
    kind: Shown['kind'],
    request: Shown['request'],
    signal: AbortSignal,
  ): Promise<string | undefined> {
    return new Promise(resolve => {
      this.shown.push({kind, request, finish: resolve, signal});
      signal.addEventListener('abort', () => {
        resolve(undefined);
      });
    });
  }
}

interface Setup {
  lease: FakeLease;
  editor: FakeEditor;
  surface: ReturnType<typeof attachPromptSurface>;
}

function setup(): Setup {
  const lease = new FakeLease();
  const editor = new FakeEditor();
  const surface = attachPromptSurface(lease, editor, {displayHost: 'box'});
  return {lease, editor, surface};
}

function question(
  context: Setup,
  promptId: number,
  text: string,
): Promise<void> {
  context.lease.send({type: 'prompt', promptId, surface: 'maskedInput', text});
  return settled();
}

function settled(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

describe('the prompt surface: a host key (F-2305)', () => {
  it('F-2305: a fingerprint question is a pick titled with the host and the fingerprint', async () => {
    const context = setup();
    await question(context, 1, FINGERPRINT_TEXT);
    deepStrictEqual(context.editor.last().request, {
      title: '<"box" has fingerprint "SHA256:abcdef".>',
      placeholder: '<Are you sure you want to continue?>',
      items: [
        {label: '<Continue>', answer: 'yes'},
        {label: '<Cancel>', answer: 'no'},
      ],
    });
  });

  it('F-2305: choosing Continue answers yes to that question', async () => {
    const context = setup();
    await question(context, 7, FINGERPRINT_TEXT);
    context.editor.last().finish('yes');
    await settled();
    deepStrictEqual(context.lease.answers, [[7, 'yes']]);
  });

  it('F-2305: dismissing the pick refuses the question through the lease', async () => {
    const context = setup();
    await question(context, 7, FINGERPRINT_TEXT);
    context.editor.last().finish(undefined);
    await settled();
    deepStrictEqual([context.lease.refused, context.lease.answers], [[7], []]);
  });
});

const CONTINUATION_TEXT = [
  'Warning: the address key differs.',
  'Offending key for IP in /home/user/.ssh/known_hosts:3',
  'Matching host key in /home/user/.ssh/known_hosts:7',
  'Are you sure you want to continue connecting (yes/no)?',
].join('\n');

describe('the prompt surface: a changed address key (F-2305)', () => {
  it('F-2305: the question is a pick titled with the lines ssh wrote before it', async () => {
    const context = setup();
    await question(context, 1, CONTINUATION_TEXT);
    deepStrictEqual(
      (context.editor.last().request as PickRequest).title,
      [
        'Warning: the address key differs.',
        'Offending key for IP in /home/user/.ssh/known_hosts:3',
        'Matching host key in /home/user/.ssh/known_hosts:7',
      ].join('\n'),
    );
  });
});

describe('the prompt surface: a masked input (F-2306, F-2307)', () => {
  it('F-2306: a verification code question has its English placeholder in every language', async () => {
    const context = setup();
    await question(context, 1, 'Verification code:');
    deepStrictEqual(context.editor.last().request, {
      placeholder: 'Enter verification code',
    });
  });

  it('F-2306: a password question is a masked input with its own placeholder', async () => {
    const context = setup();
    await question(context, 1, PASSWORD_TEXT);
    deepStrictEqual(
      [context.editor.last().kind, context.editor.last().request],
      ['input', {placeholder: '<Enter password for user@box>'}],
    );
  });

  it('F-2306: the typed text is the answer, unchanged', async () => {
    const context = setup();
    await question(context, 3, PASSWORD_TEXT);
    context.editor.last().finish('  p@ss ');
    await settled();
    deepStrictEqual(context.lease.answers, [[3, '  p@ss ']]);
  });

  it('F-2306: cancelling the input refuses the question and gives no empty answer', async () => {
    const context = setup();
    await question(context, 3, PASSWORD_TEXT);
    context.editor.last().finish(undefined);
    await settled();
    deepStrictEqual([context.lease.refused, context.lease.answers], [[3], []]);
  });
});

describe('the prompt surface: a question that goes away', () => {
  it('F-2305: a question another window answered is taken down', async () => {
    const context = setup();
    await question(context, 1, PASSWORD_TEXT);
    context.lease.send({type: 'promptClosed', promptId: 1});
    deepStrictEqual(context.editor.last().signal.aborted, true);
  });

  it('F-2305: a question taken down gives no answer', async () => {
    const context = setup();
    await question(context, 1, PASSWORD_TEXT);
    context.lease.send({type: 'promptClosed', promptId: 1});
    await settled();
    deepStrictEqual(context.lease.answers, []);
  });

  it('F-2305: closing a question that is not shown changes nothing', async () => {
    const context = setup();
    await question(context, 1, PASSWORD_TEXT);
    context.lease.send({type: 'promptClosed', promptId: 9});
    deepStrictEqual(context.editor.last().signal.aborted, false);
  });

  it('F-2305: a lost transport takes the question down', async () => {
    const context = setup();
    await question(context, 1, PASSWORD_TEXT);
    context.lease.send({type: 'transportLost'});
    deepStrictEqual(context.editor.last().signal.aborted, true);
  });

  it('F-2305: a helper that is gone takes the question down', async () => {
    const context = setup();
    await question(context, 1, PASSWORD_TEXT);
    context.lease.send({type: 'helperGone'});
    deepStrictEqual(context.editor.last().signal.aborted, true);
  });

  it('F-2305: a lease that cannot take the answer ends the question quietly', async () => {
    const context = setup();
    context.lease.refusesAnswers = true;
    await question(context, 1, PASSWORD_TEXT);
    context.editor.last().finish('secret');
    await settled();
    deepStrictEqual(context.lease.answers, [[1, 'secret']]);
  });
});

describe('the prompt surface: waiting for another window (F-2304)', () => {
  it('F-2304: the notice names the wait while another window holds the login', () => {
    const context = setup();
    context.lease.send({type: 'waitingForOtherWindow'});
    deepStrictEqual(context.editor.waiting, [
      '<Waiting for other windows to connect>',
    ]);
  });

  it('F-2304: the notice is taken down when a question arrives', async () => {
    const context = setup();
    context.lease.send({type: 'waitingForOtherWindow'});
    await question(context, 1, PASSWORD_TEXT);
    deepStrictEqual(context.editor.waitingTakenDown, 1);
  });

  it('F-2304: the notice is taken down when the owner changes', () => {
    const context = setup();
    context.lease.send({type: 'waitingForOtherWindow'});
    context.lease.send({type: 'ownerChanged', owner: 2});
    deepStrictEqual(context.editor.waitingTakenDown, 1);
  });

  it('F-2304: a second wait replaces the first notice', () => {
    const context = setup();
    context.lease.send({type: 'waitingForOtherWindow'});
    context.lease.send({type: 'waitingForOtherWindow'});
    deepStrictEqual(context.editor.waitingTakenDown, 1);
  });

  it('F-2304: the notice is taken down when the transport is lost', () => {
    const context = setup();
    context.lease.send({type: 'waitingForOtherWindow'});
    context.lease.send({type: 'transportLost'});
    deepStrictEqual(context.editor.waitingTakenDown, 1);
  });
});

describe('the prompt surface: its end', () => {
  it('F-2305: ending it stops listening to the lease', () => {
    const context = setup();
    context.surface.dispose();
    deepStrictEqual(context.lease.listeners.size, 0);
  });

  it('F-2305: ending it takes down the question and the notice', async () => {
    const context = setup();
    context.lease.send({type: 'waitingForOtherWindow'});
    await question(context, 1, PASSWORD_TEXT);
    context.lease.send({type: 'waitingForOtherWindow'});
    context.surface.dispose();
    deepStrictEqual(
      [context.editor.last().signal.aborted, context.editor.waitingTakenDown],
      [true, 2],
    );
  });
});
