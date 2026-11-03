import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {troubleshootingEditorOf} from '../../src/troubleshooting-editor.ts';
import {TERMINAL_NAME} from '../../src/diagnostics/troubleshooting.ts';

/** `value` as a `Type`, for a fake that has only the members a row reads. */
function fakeOf(value: unknown): never {
  return value as never;
}

/** A fake editor: the terminals made, the provider registered, and what the emitter fired. */
function editor() {
  const seen = {
    options: undefined as vscode.ExtensionTerminalOptions | undefined,
    shown: [] as boolean[],
    disposed: 0,
    provider: undefined as vscode.TerminalLinkProvider | undefined,
    terminal: fakeOf({}),
    fired: [] as string[],
    emittersDisposed: 0,
  };
  class Emitter<Value> {
    private listener: ((value: Value) => void) | undefined;
    event = (listener: (value: Value) => void): vscode.Disposable => {
      this.listener = listener;
      return {dispose: () => undefined};
    };
    fire(value: Value): void {
      this.listener?.(value);
    }
    dispose(): void {
      seen.emittersDisposed += 1;
    }
  }
  const fake = fakeOf({
    window: {
      createTerminal: (options: vscode.ExtensionTerminalOptions) => {
        seen.options = options;
        seen.terminal = fakeOf({
          show: (preserveFocus: boolean) => {
            seen.shown.push(preserveFocus);
          },
          dispose: () => {
            seen.disposed += 1;
          },
        });
        return seen.terminal;
      },
      registerTerminalLinkProvider: (provider: vscode.TerminalLinkProvider) => {
        seen.provider = provider;
        return {dispose: () => undefined};
      },
    },
    EventEmitter: Emitter,
  });
  return {fake, seen};
}

describe('the editor side of the troubleshooting terminal (card connect-136)', () => {
  it('makes an extension terminal under its name, whose pseudoterminal passes the editor’s calls on', () => {
    const {fake, seen} = editor();
    const calls: string[] = [];
    const made = troubleshootingEditorOf(fake, () => undefined).createTerminal(
      sink => ({
        open: columns => {
          calls.push(`open ${String(columns)}`);
          sink.write('drawn');
        },
        close: () => {
          calls.push('close');
        },
        handleInput: data => {
          calls.push(`input ${data}`);
        },
        setDimensions: columns => {
          calls.push(`size ${String(columns)}`);
        },
      }),
    );
    const driver = seen.options?.pty;
    driver?.onDidWrite(text => {
      seen.fired.push(text);
    });
    driver?.open({columns: 90, rows: 30});
    driver?.open(undefined);
    driver?.handleInput?.('x');
    driver?.setDimensions?.({columns: 70, rows: 20});
    made.show(true);
    made.dispose();
    driver?.close();
    deepStrictEqual(
      [
        seen.options?.name,
        calls,
        seen.fired,
        seen.shown,
        seen.disposed,
        seen.emittersDisposed,
      ],
      [
        TERMINAL_NAME,
        ['open 90', 'open undefined', 'input x', 'size 70', 'close'],
        ['drawn', 'drawn'],
        [true],
        1,
        1,
      ],
    );
  });

  it('gives the link of Output Log... only to its own terminal, and the link opens the log', () => {
    const {fake, seen} = editor();
    let revealed = 0;
    const troubleshooting = troubleshootingEditorOf(fake, () => {
      revealed += 1;
    });
    troubleshooting.createTerminal(() => ({
      open: () => undefined,
      close: () => undefined,
      handleInput: () => undefined,
      setDimensions: () => undefined,
    }));
    troubleshooting.registerLinks();
    const line = 'lead Output Log...';
    const token = fakeOf({});
    const own = seen.provider?.provideTerminalLinks(
      fakeOf({terminal: seen.terminal, line}),
      token,
    );
    const other = seen.provider?.provideTerminalLinks(
      fakeOf({
        terminal: fakeOf({}),
        line,
      }),
      token,
    );
    seen.provider?.handleTerminalLink(fakeOf({}));
    deepStrictEqual(
      [own, other, revealed],
      [[{startIndex: 5, length: 13, tooltip: 'Output Log...'}], [], 1],
    );
  });
});
