import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {gateEditorOf} from '../../src/index.ts';

/** A fake editor whose members record that they were used. */
function fakeEditor(events: string[], registered = false): typeof vscode {
  const document = {uri: {fsPath: '/x/argv.json'}};
  return {
    env: {remoteAuthority: undefined},
    workspace: {
      tunnels: Promise.resolve([]),
      onDidSaveTextDocument: (listener: (value: unknown) => void) => {
        listener(document);
        return {dispose: () => undefined};
      },
      onDidCloseTextDocument: (listener: (value: unknown) => void) => {
        listener(document);
        return {dispose: () => undefined};
      },
    },
    window: {
      onDidWriteTerminalData: () => ({dispose: () => undefined}),
      showWarningMessage: (text: string, ...buttons: string[]) => {
        events.push(`warning ${text} ${buttons.join('|')}`);
        return Promise.resolve(buttons[0]);
      },
      showInformationMessage: (text: string, ...buttons: string[]) => {
        events.push(`information ${text} ${buttons.join('|')}`);
        return Promise.resolve(undefined);
      },
    },
    commands: {
      getCommands: () => Promise.resolve([]),
      registerCommand: (command: string) => {
        if (registered) {
          throw new Error('already registered');
        }
        events.push(`register ${command}`);
        return {dispose: () => undefined};
      },
      executeCommand: (command: string) => {
        events.push(`execute ${command}`);
        return Promise.resolve('holder');
      },
    },
    extensions: {
      // eslint-disable-next-line id-length -- the editor's own member name
      all: [
        {
          id: 'remote-oss.remote-ssh',
          packageJSON: {enabledApiProposals: ['resolvers']},
        },
        {id: 'other.one', packageJSON: {}},
        {id: 'other.two'},
      ],
    },
  } as unknown as typeof vscode;
}

/** The extension context of a test, with the global state in `stored`. */
function contextOf(
  stored: Map<string, boolean>,
  subscriptions: Array<{dispose(): void}>,
): Pick<vscode.ExtensionContext, 'globalState' | 'subscriptions'> {
  const globalState: vscode.ExtensionContext['globalState'] = {
    keys: () => [...stored.keys()],
    // eslint-disable-next-line id-length -- the editor's own member name
    get: (key: string) => stored.get(key) as never,
    update: (key: string, value: unknown) => {
      stored.set(key, value as boolean);
      return Promise.resolve();
    },
    setKeysForSync: () => undefined,
  };
  return {globalState, subscriptions};
}

describe('the editor behind the setup', () => {
  it('lists the installed extensions with the proposals they declare', () => {
    const edit = gateEditorOf(fakeEditor([]), contextOf(new Map(), []), () =>
      Promise.resolve(undefined),
    );
    deepStrictEqual(edit.installed(), [
      {id: 'remote-oss.remote-ssh', proposals: ['resolvers']},
      {id: 'other.one', proposals: []},
      {id: 'other.two', proposals: []},
    ]);
  });

  it('keeps the flags in the global state of the extension', async () => {
    const edit = gateEditorOf(fakeEditor([]), contextOf(new Map(), []), () =>
      Promise.resolve(undefined),
    );
    await edit.state.update('flag', true);
    deepStrictEqual(
      [edit.state.read('flag'), edit.state.read('other')],
      [true, undefined],
    );
  });

  it('reports the paths of saved and closed documents', () => {
    const edit = gateEditorOf(fakeEditor([]), contextOf(new Map(), []), () =>
      Promise.resolve(undefined),
    );
    const paths: string[] = [];
    edit.documents.onSaved(documentPath => paths.push(documentPath));
    edit.documents.onClosed(documentPath => paths.push(documentPath));
    deepStrictEqual(paths, ['/x/argv.json', '/x/argv.json']);
  });

  it('shows messages and runs commands through the editor', async () => {
    const events: string[] = [];
    const edit = gateEditorOf(
      fakeEditor(events),
      contextOf(new Map(), []),
      () => Promise.resolve(undefined),
    );
    await edit.showWarning('careful', ['Yes', 'No']);
    await edit.showInformation('note', ['Ok']);
    await edit.runCommand('some.command');
    deepStrictEqual(events, [
      'warning careful Yes|No',
      'information note Ok',
      'execute some.command',
    ]);
  });

  it('claims the window through a command that the extension releases on deactivation', async () => {
    const events: string[] = [];
    const subscriptions: Array<{dispose(): void}> = [];
    const edit = gateEditorOf(
      fakeEditor(events),
      contextOf(new Map(), subscriptions),
      () => Promise.resolve(undefined),
    );
    deepStrictEqual(
      [
        await edit.window.claim('remote-oss.remote-ssh'),
        events,
        subscriptions.length,
      ],
      [
        {holder: 'remote-oss.remote-ssh'},
        ['register remote-oss.gate.claim'],
        1,
      ],
    );
  });

  it('asks the holder when the claim command is registered already', async () => {
    const events: string[] = [];
    const edit = gateEditorOf(
      fakeEditor(events, true),
      contextOf(new Map(), []),
      () => Promise.resolve(undefined),
    );
    deepStrictEqual(
      [await edit.window.claim('remote-oss.remote-ssh'), events],
      [{holder: 'holder'}, ['execute remote-oss.gate.claim']],
    );
  });

  it('reads files through the function it was given', async () => {
    const edit = gateEditorOf(
      fakeEditor([]),
      contextOf(new Map(), []),
      filePath => Promise.resolve(`text of ${filePath}`),
    );
    deepStrictEqual(await edit.readFile('/x'), 'text of /x');
  });
});
