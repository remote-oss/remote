import {deepStrictEqual, strictEqual} from 'node:assert';
import {type EditorApi, standDownHost} from '../../src/index.ts';

interface EditorCalls {
  executed: unknown[][];
}

const INSTALLED = 'publisher.other-extension';

function fakeEditor(calls: EditorCalls): EditorApi {
  const fake = {
    extensions: {
      getExtension: (extensionId: string) =>
        extensionId === INSTALLED ? {id: INSTALLED} : undefined,
    },
    commands: {
      executeCommand: (...commandArguments: unknown[]) => {
        calls.executed.push(commandArguments);
        return Promise.resolve();
      },
    },
    window: {
      showWarningMessage: (text: string, button: string) =>
        Promise.resolve(button),
    },
  };
  // The fake implements only the members the adapter calls.
  return fake as unknown as EditorApi;
}

describe('standDownHost', () => {
  let calls: EditorCalls;

  beforeEach(() => {
    calls = {executed: []};
  });

  it('finds an extension the editor runs in this host', () => {
    strictEqual(standDownHost(fakeEditor(calls)).isRunning(INSTALLED), true);
  });

  it('does not find an extension the editor does not run', () => {
    strictEqual(
      standDownHost(fakeEditor(calls)).isRunning('publisher.absent'),
      false,
    );
  });

  it('sets a context key through the setContext command', async () => {
    await standDownHost(fakeEditor(calls)).setContext(
      'remote-x.standingDown',
      true,
    );
    deepStrictEqual(calls.executed, [
      ['setContext', 'remote-x.standingDown', true],
    ]);
  });

  it('shows a warning with one button and resolves to the choice', async () => {
    strictEqual(
      await standDownHost(fakeEditor(calls)).showWarning('Text', 'Button'),
      'Button',
    );
  });

  it('searches the Extensions view for the extension id', async () => {
    await standDownHost(fakeEditor(calls)).revealExtension(INSTALLED);
    deepStrictEqual(calls.executed, [
      ['workbench.extensions.search', '@id:publisher.other-extension'],
    ]);
  });
});
