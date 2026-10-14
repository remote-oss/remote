import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {
  linkTerminalsOf,
  terminalEnvironmentOf,
} from '../../src/surfaces/window-forwarding.ts';

/** A terminal the fake editor made: the options it was given, its exit status and its disposals. */
interface FakeTerminal {
  options: vscode.TerminalOptions;
  exitStatus: {code: number | undefined} | undefined;
  disposals: number;
  dispose(): void;
}

/** An editor whose terminals are recorded, and that closes one when the test says so. */
function fakeEditor(): {
  editor: Pick<typeof vscode, 'window'>;
  created: FakeTerminal[];
  close: (terminal: unknown, code?: number) => void;
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
          exitStatus: undefined,
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
    close: (terminal, code) => {
      if (code !== undefined) {
        (terminal as FakeTerminal).exitStatus = {code};
      }
      for (const listener of [...closeListeners]) {
        listener(terminal);
      }
    },
  };
}

/** Runs the link command in a link terminal of `fake`, the way the forwarding does. */
function runIn(
  fake: ReturnType<typeof fakeEditor>,
): Promise<number | undefined> {
  return linkTerminalsOf(fake.editor).runProgram(
    'Remote - SSH agent link',
    '/bin/sh',
    [
      '-c',
      'ln -sfn -- "$1" "$2"',
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
            'ln -sfn -- "$1" "$2"',
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

  it('F-2311 7.E7: the run gives the exit status once the terminal closed, and disposes it', async () => {
    const fake = fakeEditor();
    const running = runIn(fake);
    fake.close(fake.created[0], 1);
    deepStrictEqual([await running, fake.created[0]?.disposals], [1, 1]);
  });

  it('F-2311 7.E7: a terminal that closes with no exit status gives none', async () => {
    const fake = fakeEditor();
    const running = runIn(fake);
    fake.close(fake.created[0]);
    deepStrictEqual(await running, undefined);
  });

  it("F-2311 R6: another terminal's close is not the link terminal's", async () => {
    const fake = fakeEditor();
    const running = runIn(fake);
    fake.close({other: true}, 2);
    fake.close(fake.created[0], 0);
    deepStrictEqual(await running, 0);
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
