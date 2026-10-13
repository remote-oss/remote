import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {gateEditorOf} from '../../src/index.ts';

/** A fake editor whose members record that they were used. */
function fakeEditor(events: string[], registered = false): typeof vscode {
  const document = {uri: {fsPath: '/x/argv.json'}};
  return {
    env: {appCommit: undefined},
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
      all: [
        {
          id: 'remote-oss.remote-ssh',
          extensionPath: '/ext/ssh',
          // The editor strips the proposals it does not allow from this copy of the manifest.
          packageJSON: {enabledApiProposals: []},
        },
        {id: 'remote-oss.remote-explorer', extensionPath: '/ext/explorer'},
        {id: 'remote-oss.remote-broken', extensionPath: '/ext/broken'},
        {id: 'remote-oss.remote-odd', extensionPath: '/ext/odd'},
        {id: 'other.one', extensionPath: '/ext/one', packageJSON: {}},
      ],
    },
  } as unknown as typeof vscode;
}

/** The manifest files of the family's extensions in the fake editor, by path. */
const MANIFESTS = new Map<string, string>([
  [
    '/ext/ssh/package.json',
    '{"enabledApiProposals": ["resolvers", "tunnels"]}',
  ],
  ['/ext/explorer/package.json', '{"name": "explorer"}'],
  ['/ext/broken/package.json', '{not json'],
  ['/ext/odd/package.json', '{"enabledApiProposals": ["resolvers", 3]}'],
]);

/** The setup's editor over the fake one, reading the family's manifests, and what its notices and log were told. */
function setupEditor(
  events: string[],
  options: {
    registered?: boolean;
    stored?: Map<string, boolean>;
    subscriptions?: Array<{dispose(): void}>;
    readFile?: (filePath: string) => Promise<string | undefined>;
  } = {},
) {
  const failures: string[] = [];
  const read = new Array<string>();
  const edit = gateEditorOf(
    fakeEditor(events, options.registered),
    contextOf(
      options.stored ?? new Map<string, boolean>(),
      options.subscriptions ?? [],
    ),
    options.readFile ??
      (filePath => {
        read.push(filePath);
        return Promise.resolve(MANIFESTS.get(filePath));
      }),
    message => failures.push(message),
    {
      showWarning: (text, buttons) => {
        events.push(`warning ${text} ${buttons.join('|')}`);
        return Promise.resolve(buttons[0]);
      },
      showInformation: (text, buttons) => {
        events.push(`information ${text} ${buttons.join('|')}`);
        return Promise.resolve(undefined);
      },
    },
  );
  return {edit, failures, read};
}

/** The extension context of a test, with the global state in `stored`. */
function contextOf(
  stored: Map<string, boolean>,
  subscriptions: Array<{dispose(): void}>,
): Pick<vscode.ExtensionContext, 'globalState' | 'subscriptions'> {
  const globalState: vscode.ExtensionContext['globalState'] = {
    keys: () => [...stored.keys()],
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
  it('F-3903 §5 rule 4: a member of the family declares what its own manifest file says, whatever the editor kept', async () => {
    const {edit} = setupEditor([]);
    deepStrictEqual(
      (await edit.installed()).find(
        each => each.id === 'remote-oss.remote-ssh',
      ),
      {id: 'remote-oss.remote-ssh', proposals: ['resolvers', 'tunnels']},
    );
  });

  it('F-3903 §5 rule 4: a member whose manifest declares none declares none', async () => {
    const {edit} = setupEditor([]);
    deepStrictEqual(
      (await edit.installed()).find(
        each => each.id === 'remote-oss.remote-explorer',
      ),
      {id: 'remote-oss.remote-explorer', proposals: []},
    );
  });

  it('F-3903 §5 rule 4: a member whose manifest cannot be read declares none, and the log says why', async () => {
    const {edit, failures} = setupEditor([], {
      readFile: () => Promise.resolve(undefined),
    });
    await edit.installed();
    deepStrictEqual(failures.slice(0, 1), [
      'the manifest of remote-oss.remote-ssh cannot be read: /ext/ssh/package.json',
    ]);
  });

  it('F-3903 §5 rule 4: a member whose manifest cannot be parsed declares none, and the log says why', async () => {
    const {edit, failures} = setupEditor([]);
    await edit.installed();
    deepStrictEqual(
      failures.map(failure =>
        failure.slice(0, failure.indexOf('cannot be parsed') + 16),
      ),
      ['the manifest of remote-oss.remote-broken cannot be parsed'],
    );
  });

  it('F-3903 §5 rule 4: only the proposals that are text are taken from a manifest', async () => {
    const {edit} = setupEditor([]);
    deepStrictEqual(
      (await edit.installed()).find(each => each.id === 'remote-oss.remote-odd')
        ?.proposals,
      ['resolvers'],
    );
  });

  it('F-3903 §5 rule 4: the files of other extensions are not read', async () => {
    const {edit, read} = setupEditor([]);
    await edit.installed();
    deepStrictEqual(
      read.filter(file => file.startsWith('/ext/one')),
      [],
    );
  });

  it('F-3903 §5 rule 4: an extension that is not of the family declares none', async () => {
    const {edit} = setupEditor([]);
    deepStrictEqual(
      (await edit.installed()).find(each => each.id === 'other.one'),
      {id: 'other.one', proposals: []},
    );
  });

  it('keeps the flags in the global state of the extension', async () => {
    const {edit} = setupEditor([]);
    await edit.state.update('flag', true);
    deepStrictEqual(
      [edit.state.read('flag'), edit.state.read('other')],
      [true, undefined],
    );
  });

  it('reports the paths of saved and closed documents', () => {
    const {edit} = setupEditor([]);
    const paths: string[] = [];
    edit.documents.onSaved(documentPath => paths.push(documentPath));
    edit.documents.onClosed(documentPath => paths.push(documentPath));
    deepStrictEqual(paths, ['/x/argv.json', '/x/argv.json']);
  });

  it("card connect-31: the setup's notices go through the notices it was given", async () => {
    const events: string[] = [];
    const {edit} = setupEditor(events);
    await edit.showWarning('careful', ['Yes', 'No']);
    await edit.showInformation('note', ['Ok']);
    deepStrictEqual(events, ['warning careful Yes|No', 'information note Ok']);
  });

  it('runs commands through the editor', async () => {
    const events: string[] = [];
    const {edit} = setupEditor(events);
    await edit.runCommand('some.command');
    deepStrictEqual(events, ['execute some.command']);
  });

  it('claims the window through a command that the extension releases on deactivation', async () => {
    const events: string[] = [];
    const subscriptions: Array<{dispose(): void}> = [];
    const {edit} = setupEditor(events, {subscriptions});
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
    const {edit} = setupEditor(events, {registered: true});
    deepStrictEqual(
      [await edit.window.claim('remote-oss.remote-ssh'), events],
      [{holder: 'holder'}, ['execute remote-oss.gate.claim']],
    );
  });

  it('reads files through the function it was given', async () => {
    const {edit} = setupEditor([], {
      readFile: filePath => Promise.resolve(`text of ${filePath}`),
    });
    deepStrictEqual(await edit.readFile('/x'), 'text of /x');
  });
});
