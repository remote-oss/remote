import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {
  linkTerminalsOf,
  terminalEnvironmentOf,
} from '../../src/surfaces/window-forwarding.ts';

/** An event emitter as the editor's: listeners, a fire and a disposal, recorded. */
class FakeEmitter<Value> {
  readonly fired: Value[] = [];
  disposals = 0;
  private readonly listeners: Array<(value: Value) => void> = [];

  readonly event = (listener: (value: Value) => void): {dispose(): void} => {
    this.listeners.push(listener);
    return {dispose: () => undefined};
  };

  fire(value: Value): void {
    this.fired.push(value);
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose(): void {
    this.disposals += 1;
  }
}

/** The options a created terminal was given, its pseudoterminal included. */
interface CreatedTerminal {
  name: string;
  pty: vscode.Pseudoterminal;
}

/** An editor whose `createTerminal` records the options, with the emitters it made. */
function fakeEditor(): {
  editor: Pick<typeof vscode, 'window' | 'EventEmitter'>;
  created: CreatedTerminal[];
  emitters: Array<FakeEmitter<unknown>>;
} {
  const created: CreatedTerminal[] = [];
  const emitters: Array<FakeEmitter<unknown>> = [];
  const editor = {
    ['EventEmitter']: class extends FakeEmitter<unknown> {
      constructor() {
        super();
        emitters.push(this);
      }
    },
    window: {
      createTerminal: (options: CreatedTerminal) => {
        created.push(options);
        return {};
      },
    },
  } as unknown as Pick<typeof vscode, 'window' | 'EventEmitter'>;
  return {editor, created, emitters};
}

describe('the link terminals in the editor', () => {
  it('F-2311 5.0 step 5: one open creates one extension terminal of that name, and runs nothing yet', () => {
    const {editor, created} = fakeEditor();
    const runs: string[] = [];
    linkTerminalsOf(editor).open('Remote - SSH agent link', () => {
      runs.push('run');
      return Promise.resolve();
    });
    deepStrictEqual(
      [created.map(options => Object.keys(options).sort()), runs],
      [[['name', 'pty']], []],
    );
  });

  it('F-2311 5.0 step 6: the editor opening it runs the work, then the terminal closes', async () => {
    const {editor, created, emitters} = fakeEditor();
    const order: string[] = [];
    linkTerminalsOf(editor).open('Remote - SSH agent link', () => {
      order.push('run');
      return Promise.resolve();
    });
    const terminal = created[0];
    terminal?.pty.onDidClose?.(() => {
      order.push('close');
    });
    terminal?.pty.open(undefined);
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      [order, emitters.map(emitter => emitter.disposals)],
      [
        ['run', 'close'],
        [1, 1],
      ],
    );
  });

  it('F-2311 7.E7: work that rejects still closes the terminal', async () => {
    const {editor, created} = fakeEditor();
    linkTerminalsOf(editor).open('Remote - SSH agent link', () =>
      Promise.reject(new Error('no channel')),
    );
    const order: string[] = [];
    created[0]?.pty.onDidClose?.(() => {
      order.push('close');
    });
    created[0]?.pty.open(undefined);
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(order, ['close']);
  });

  it('F-2311 R6: a close the user asks for does nothing more', () => {
    const {editor, created} = fakeEditor();
    linkTerminalsOf(editor).open('Remote - SSH agent link', () =>
      Promise.resolve(),
    );
    deepStrictEqual(created[0]?.pty.close(), undefined);
  });
});

/** A collection as the editor's, recording each call. */
function fakeCollection(): Pick<
  vscode.EnvironmentVariableCollection,
  'persistent' | 'clear' | 'replace'
> & {calls: string[]} {
  const calls: string[] = [];
  return {
    calls,
    set persistent(value: boolean) {
      calls.push(`persistent ${String(value)}`);
    },
    get persistent() {
      return true;
    },
    clear: () => {
      calls.push('clear');
    },
    replace: (name, value) => {
      calls.push(`replace ${name}=${value}`);
    },
  };
}

describe("the window's terminal environment in the editor", () => {
  it('F-2311.AC-6, F-2312.AC-5: the collection holds exactly the two variables, not kept for later', () => {
    const collection = fakeCollection();
    terminalEnvironmentOf(collection)({
      SSH_AUTH_SOCK: '/tmp/vscode-ssh-auth-sock-42',
      DISPLAY: 'localhost:10.0',
    });
    deepStrictEqual(collection.calls, [
      'persistent false',
      'clear',
      'replace SSH_AUTH_SOCK=/tmp/vscode-ssh-auth-sock-42',
      'replace DISPLAY=localhost:10.0',
    ]);
  });

  it('F-2311.AC-6, F-2312.AC-5: with none plans, the collection is cleared', () => {
    const collection = fakeCollection();
    terminalEnvironmentOf(collection)({});
    deepStrictEqual(collection.calls, ['persistent false', 'clear']);
  });
});
