import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import type {Invocation, TerminalEnd} from 'lib-ssh';
import {loginTerminalsOf} from '../../src/surfaces/login-terminal.ts';

const INVOCATION: Invocation = {
  program: 'ssh',
  arguments: ['-T', 'host'],
  environment: {TERM: 'dumb'},
};

const REASONS = {Unknown: 0, Shutdown: 1, Process: 2, User: 3, Extension: 4};

interface FakeTerminal {
  exitStatus: {code: number | undefined; reason: number} | undefined;
  sentTexts: Array<[string, boolean]>;
  shown: boolean[];
  disposals: number;
  sendText(text: string, addNewLine: boolean): void;
  show(preserveFocus: boolean): void;
  dispose(): void;
}

function fakeTerminal(): FakeTerminal {
  const terminal: FakeTerminal = {
    exitStatus: undefined,
    sentTexts: [],
    shown: [],
    disposals: 0,
    sendText: (text, addNewLine) => {
      terminal.sentTexts.push([text, addNewLine]);
    },
    show: preserveFocus => {
      terminal.shown.push(preserveFocus);
    },
    dispose: () => {
      terminal.disposals++;
    },
  };
  return terminal;
}

function fakeEditor() {
  const dataListeners: Array<
    (event: {terminal: unknown; data: string}) => void
  > = [];
  const closeListeners: Array<(terminal: unknown) => void> = [];
  const created: Array<{hideFromUser: boolean} & Record<string, unknown>> = [];
  const terminal = fakeTerminal();
  const editor = {
    TerminalExitReason: REASONS,
    window: {
      onDidWriteTerminalData: (
        listener: (event: {terminal: unknown; data: string}) => void,
      ) => {
        dataListeners.push(listener);
        return {
          dispose: () =>
            dataListeners.splice(dataListeners.indexOf(listener), 1),
        };
      },
      onDidCloseTerminal: (listener: (closed: unknown) => void) => {
        closeListeners.push(listener);
        return {
          dispose: () =>
            closeListeners.splice(closeListeners.indexOf(listener), 1),
        };
      },
      createTerminal: (
        options: {hideFromUser: boolean} & Record<string, unknown>,
      ) => {
        created.push(options);
        return terminal;
      },
    },
  } as unknown as Pick<typeof vscode, 'window' | 'TerminalExitReason'>;
  return {
    editor,
    terminal,
    created,
    write: (data: string, target: unknown = terminal) => {
      for (const listener of [...dataListeners]) {
        listener({terminal: target, data});
      }
    },
    close: (target: unknown = terminal) => {
      for (const listener of [...closeListeners]) {
        listener(target);
      }
    },
  };
}

function opened(reveal = false) {
  const fake = fakeEditor();
  const session = loginTerminalsOf(fake.editor, '/home/a').open(
    INVOCATION,
    'install',
    reveal,
  );
  const output: string[] = [];
  const ends: TerminalEnd[] = [];
  session.onOutput(text => output.push(text));
  session.onEnd(end => ends.push(end));
  return {...fake, session, output, ends};
}

describe('loginTerminalsOf (card ssh-18 table)', () => {
  it('F-2308 §16: creates a hidden terminal in the home folder with the invocation', () => {
    deepStrictEqual(opened().created, [
      {
        name: 'install',
        shellPath: 'ssh',
        shellArgs: ['-T', 'host'],
        cwd: '/home/a',
        env: {TERM: 'dumb'},
        hideFromUser: true,
      },
    ]);
  });

  it('F-2308 BR-2: a revealed terminal is not hidden', () => {
    deepStrictEqual(opened(true).created[0]?.hideFromUser, false);
  });

  it('F-2308 BR-2: a revealed terminal is shown once at the open', () => {
    deepStrictEqual(opened(true).terminal.shown, [false]);
  });

  it('F-2308 BR-4: a hidden terminal is not shown', () => {
    deepStrictEqual(opened().terminal.shown, []);
  });

  it('#299: output reaches the listener as plain text with its line ends normalised', () => {
    const made = opened();
    made.write('\x1b[0mok\r\n');
    deepStrictEqual(made.output, ['ok\n']);
  });

  it('F-2308: output of another terminal is ignored', () => {
    const made = opened();
    made.write('other', {});
    deepStrictEqual(made.output, []);
  });

  it('#299: a piece with no plain text delivers nothing', () => {
    const made = opened();
    made.write('\x1b[0m');
    deepStrictEqual(made.output, []);
  });

  it('F-2308: the end after output tells the exit code and reason', () => {
    const made = opened();
    made.write('x');
    made.terminal.exitStatus = {code: 0, reason: REASONS.Process};
    made.close();
    deepStrictEqual(made.ends, [{code: 0, reason: 'process', hadOutput: true}]);
  });

  it('F-2308 7.E7: an end with no code, no output and an unknown reason', () => {
    const made = opened();
    made.terminal.exitStatus = {code: undefined, reason: REASONS.Unknown};
    made.close();
    deepStrictEqual(made.ends, [
      {code: undefined, reason: 'unknown', hadOutput: false},
    ]);
  });

  const reasons: Array<[number, TerminalEnd['reason']]> = [
    [REASONS.Shutdown, 'shutdown'],
    [REASONS.User, 'user'],
    [REASONS.Extension, 'extension'],
  ];
  for (const [reason, name] of reasons) {
    it(`F-2308: exit reason ${String(reason)} is ${name}`, () => {
      const made = opened();
      made.terminal.exitStatus = {code: undefined, reason};
      made.close();
      deepStrictEqual(made.ends[0]?.reason, name);
    });
  }

  it('F-2308: an end with no exit status is unknown', () => {
    const made = opened();
    made.close();
    deepStrictEqual(made.ends, [
      {code: undefined, reason: 'unknown', hadOutput: false},
    ]);
  });

  it('F-2308: the close of another terminal is ignored', () => {
    const made = opened();
    made.close({});
    deepStrictEqual(made.ends, []);
  });

  it('F-2308: no output is delivered after the close', () => {
    const made = opened();
    made.close();
    made.write('late');
    deepStrictEqual(made.output, []);
  });

  it('F-2308: a listener registered after the end is called at once', () => {
    const made = opened();
    made.close();
    const late: TerminalEnd[] = [];
    made.session.onEnd(end => late.push(end));
    deepStrictEqual(late, made.ends);
  });

  it('F-2308 BR-6: send writes the text without a line end', () => {
    const made = opened();
    made.session.send('pw\r');
    deepStrictEqual(made.terminal.sentTexts, [['pw\r', false]]);
  });

  it('F-2308 BR-2: reveal shows the terminal with focus', () => {
    const made = opened();
    made.session.reveal();
    deepStrictEqual(made.terminal.shown, [false]);
  });

  it('F-2308: disposing twice disposes the terminal once', () => {
    const made = opened();
    made.session.dispose();
    made.session.dispose();
    deepStrictEqual(made.terminal.disposals, 1);
  });
});
