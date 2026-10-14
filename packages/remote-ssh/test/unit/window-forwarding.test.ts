import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {
  linkTerminalsOf,
  terminalEnvironmentOf,
} from '../../src/surfaces/window-forwarding.ts';

/** A terminal the fake editor made: the options it was given and its disposals. */
interface FakeTerminal {
  options: vscode.TerminalOptions;
  disposals: number;
  dispose(): void;
}

/** An editor whose terminals are recorded, and that closes one when the test says so. */
function fakeEditor(): {
  editor: Pick<typeof vscode, 'window'>;
  created: FakeTerminal[];
  close: (terminal: unknown) => void;
} {
  const created: FakeTerminal[] = [];
  const closeListeners = new Set<(terminal: unknown) => void>();
  const editor = {
    window: {
      onDidCloseTerminal: (listener: (closed: unknown) => void) => {
        closeListeners.add(listener);
        return {dispose: () => closeListeners.delete(listener)};
      },
      createTerminal: (options: vscode.TerminalOptions) => {
        const terminal: FakeTerminal = {
          options,
          disposals: 0,
          dispose: () => {
            terminal.disposals += 1;
          },
        };
        created.push(terminal);
        return terminal;
      },
    },
  } as unknown as Pick<typeof vscode, 'window'>;
  return {
    editor,
    created,
    close: terminal => {
      for (const listener of [...closeListeners]) {
        listener(terminal);
      }
    },
  };
}

/** Runs the link command in a link terminal of `fake`, the way the forwarding does. */
function runIn(fake: ReturnType<typeof fakeEditor>): Promise<void> {
  return linkTerminalsOf(fake.editor).runProgram(
    'Remote - SSH agent link',
    '/bin/sh',
    [
      '-c',
      'ln -sfn -- "$1" "$2" 2>/dev/null; exit 0',
      'sh',
      '/tmp/ssh-x/agent.1',
      '/tmp/vscode-ssh-auth-sock-42',
    ],
  );
}

describe('the link terminals in the editor', () => {
  it('F-2311 5.0 step 5, R6: one run creates one hidden, transient terminal of the program, with no folder', () => {
    const fake = fakeEditor();
    void runIn(fake);
    deepStrictEqual(
      fake.created.map(terminal => terminal.options),
      [
        {
          name: 'Remote - SSH agent link',
          shellPath: '/bin/sh',
          shellArgs: [
            '-c',
            'ln -sfn -- "$1" "$2" 2>/dev/null; exit 0',
            'sh',
            '/tmp/ssh-x/agent.1',
            '/tmp/vscode-ssh-auth-sock-42',
          ],
          hideFromUser: true,
          isTransient: true,
        },
      ],
    );
  });

  it('F-2311 5.0 step 6: the run settles once its terminal closed, and disposes it', async () => {
    const fake = fakeEditor();
    const order: string[] = [];
    const running = runIn(fake).then(() => {
      order.push('settled');
    });
    await settledTurns();
    order.push('close');
    fake.close(fake.created[0]);
    await running;
    deepStrictEqual(
      [order, fake.created[0]?.disposals],
      [['close', 'settled'], 1],
    );
  });

  it("F-2311 R6: another terminal's close leaves the link terminal's run open", async () => {
    const fake = fakeEditor();
    let settled = false;
    void runIn(fake).then(() => {
      settled = true;
    });
    fake.close({other: true});
    await settledTurns();
    deepStrictEqual(settled, false);
  });
});

/** Lets the promises already resolved run their callbacks. */
async function settledTurns(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

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
