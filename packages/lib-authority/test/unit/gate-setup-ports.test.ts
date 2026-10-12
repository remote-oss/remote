import {deepStrictEqual} from 'node:assert';
import type {ProbeApi} from 'lib-authority';
import {
  type GateEditor,
  type GateIdentity,
  setupPortsOf,
} from '../../src/gate/setup-ports.ts';

interface Seen {
  commands: string[];
  warnings: Array<{text: string; buttons: readonly string[]}>;
  informations: Array<{text: string; buttons: readonly string[]}>;
  stored: Map<string, boolean>;
  files: string[];
}

function surroundings(
  options: {
    answer?: string;
    argvText?: string;
    installed?: Array<{id: string; proposals: string[]}>;
    resolversThrow?: boolean;
  } = {},
): {editor: GateEditor; identity: GateIdentity; seen: Seen} {
  const seen: Seen = {
    commands: [],
    warnings: [],
    informations: [],
    stored: new Map(),
    files: [],
  };
  const probeApi: ProbeApi = {
    get appCommit() {
      if (options.resolversThrow === true) {
        throw new Error('not enabled');
      }
      return undefined;
    },
    tunnels: Promise.resolve([]),
    onDidWriteTerminalData: () => ({dispose: () => undefined}),
    getCommands: () => Promise.resolve([]),
  };
  const editor: GateEditor = {
    probeApi,
    installed: () =>
      options.installed ?? [
        {id: 'remote-oss.remote-explorer', proposals: ['contribViewsRemote']},
        {id: 'remote-oss.remote-ssh', proposals: ['resolvers']},
        {id: 'remote-oss.remote-ssh-edit', proposals: []},
        {id: 'other.extension', proposals: ['resolvers']},
      ],
    readFile: filePath => {
      seen.files.push(filePath);
      return Promise.resolve(options.argvText);
    },
    state: {
      read: key => seen.stored.get(key),
      update: (key, value) => {
        seen.stored.set(key, value);
        return Promise.resolve();
      },
    },
    documents: {
      onSaved: () => ({dispose: () => undefined}),
      onClosed: () => ({dispose: () => undefined}),
    },
    window: {claim: extensionId => Promise.resolve({holder: extensionId})},
    showWarning: (text, buttons) => {
      seen.warnings.push({text, buttons});
      return Promise.resolve(options.answer);
    },
    showInformation: (text, buttons) => {
      seen.informations.push({text, buttons});
      return Promise.resolve(options.answer);
    },
    runCommand: command => {
      seen.commands.push(command);
      return Promise.resolve();
    },
  };
  const identity: GateIdentity = {
    extensionId: 'remote-oss.remote-ssh',
    displayName: 'Remote - SSH',
    applicationName: 'VSCodium',
    proposals: ['resolvers'],
    argv: {
      portableFolder: undefined,
      homeFolder: '/home/user',
      dataFolderName: () => Promise.resolve('.vscode-oss'),
    },
    platform: 'linux',
    texts: {
      setup:
        "{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.",
      failedAttempt:
        "The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-ssh', then restart {1}.",
      restart: 'Quit and start {1} again to apply the changes to argv.json.',
      configureButton: 'Configure Runtime Arguments',
      notNowButton: 'Not Now',
      quitButton: 'Quit {1}',
    },
    logFailure: () => undefined,
  };
  return {editor, identity, seen};
}

describe('the ports of the proposed-API setup', () => {
  it('names the family extensions that declare proposals, and probes the declared ones', async () => {
    const {editor, identity} = surroundings({resolversThrow: true});
    const ports = setupPortsOf(editor, identity);
    deepStrictEqual(
      [ports.installedFamilyIds(), await ports.probe()],
      [
        ['remote-oss.remote-explorer', 'remote-oss.remote-ssh'],
        [{proposal: 'resolvers', state: 'missing'}],
      ],
    );
  });

  it('reads the enabled ids from the argv file of the install', async () => {
    const {editor, identity, seen} = surroundings({
      argvText: '{"enable-proposed-api": ["remote-oss.remote-ssh"]}',
    });
    const enabled = await setupPortsOf(editor, identity).argvEnabled();
    deepStrictEqual(
      [enabled, seen.files],
      [['remote-oss.remote-ssh'], ['/home/user/.vscode-oss/argv.json']],
    );
  });

  it('keeps the two flags in the global state, false until set', async () => {
    const {editor, identity} = surroundings();
    const {flags} = setupPortsOf(editor, identity);
    const before = [flags.dismissed(), flags.attemptPending()];
    await flags.setDismissed(true);
    await flags.setAttemptPending(true);
    deepStrictEqual(
      [before, flags.dismissed(), flags.attemptPending()],
      [[false, false], true, true],
    );
  });

  it('shows the setup notice with the quoted ids and "configure" when the first button is pressed', async () => {
    const {editor, identity, seen} = surroundings({
      answer: 'Configure Runtime Arguments',
    });
    const answer = await setupPortsOf(editor, identity).showSetup({
      kind: 'setup',
      argvEntries: ['remote-oss.remote-ssh', 'remote-oss.remote-explorer'],
    });
    deepStrictEqual(
      [answer, seen.warnings],
      [
        'configure',
        [
          {
            text: "Remote - SSH needs proposed VS Code APIs that VSCodium has not enabled for it. Add 'remote-oss.remote-ssh', 'remote-oss.remote-explorer' to 'enable-proposed-api' in argv.json, then restart VSCodium.",
            buttons: ['Configure Runtime Arguments', 'Not Now'],
          },
        ],
      ],
    );
  });

  it('answers "notNow" to Not Now and to closing the notice', async () => {
    const pressed = surroundings({answer: 'Not Now'});
    const closed = surroundings();
    const notice = {kind: 'setup', argvEntries: []} as const;
    deepStrictEqual(
      [
        await setupPortsOf(pressed.editor, pressed.identity).showSetup(notice),
        await setupPortsOf(closed.editor, closed.identity).showSetup(notice),
      ],
      ['notNow', 'notNow'],
    );
  });

  it('F-2001 §3.4: the failed-attempt notice names the own id literally', async () => {
    const {editor, identity, seen} = surroundings();
    await setupPortsOf(editor, identity).showSetup({kind: 'failedAttempt'});
    const text = seen.warnings[0]?.text ?? '';
    deepStrictEqual(
      [
        text.includes("lists 'remote-oss.remote-ssh', then restart"),
        text.includes('{2}'),
      ],
      [true, false],
    );
  });

  it('offers the restart with a quit button, and answers "quit" or "later"', async () => {
    const quits = surroundings({answer: 'Quit VSCodium'});
    const closes = surroundings();
    deepStrictEqual(
      [
        await setupPortsOf(quits.editor, quits.identity).showRestart(),
        await setupPortsOf(closes.editor, closes.identity).showRestart(),
        quits.seen.informations,
      ],
      [
        'quit',
        'later',
        [
          {
            text: 'Quit and start VSCodium again to apply the changes to argv.json.',
            buttons: ['Quit VSCodium'],
          },
        ],
      ],
    );
  });

  it('passes a failure of the setup to the log', () => {
    const {editor, identity} = surroundings();
    const logged: string[] = [];
    setupPortsOf(editor, {
      ...identity,
      logFailure: message => {
        logged.push(message);
      },
    }).logFailure('the setup was given up');
    deepStrictEqual(logged, ['the setup was given up']);
  });

  it('opens the runtime arguments and quits through the editor commands', async () => {
    const {editor, identity, seen} = surroundings();
    const ports = setupPortsOf(editor, identity);
    await ports.configureRuntimeArguments();
    await ports.quit();
    deepStrictEqual(seen.commands, [
      'workbench.action.configureRuntimeArguments',
      'workbench.action.quit',
    ]);
  });

  /** The editor of a test whose document events the test fires by hand. */
  function firing(): {
    editor: GateEditor;
    identity: GateIdentity;
    fire: (event: 'save' | 'close', documentPath: string) => void;
    logged: string[];
  } {
    const {editor, identity} = surroundings();
    const saves: Array<(documentPath: string) => void> = [];
    const closes: Array<(documentPath: string) => void> = [];
    const logged: string[] = [];
    editor.documents = {
      onSaved: listener => {
        saves.push(listener);
        return {dispose: () => undefined};
      },
      onClosed: listener => {
        closes.push(listener);
        return {dispose: () => undefined};
      },
    };
    return {
      editor,
      identity: {
        ...identity,
        logFailure: message => {
          logged.push(message);
        },
      },
      fire: (event, documentPath) => {
        for (const listener of event === 'save' ? saves : closes) {
          listener(documentPath);
        }
      },
      logged,
    };
  }

  /** Starts the wait for an edit, and fires the given events at the documents once it is under way. */
  async function editAfter(
    events: ReadonlyArray<readonly ['save' | 'close', string]>,
    platform = 'linux',
  ): Promise<boolean | 'unsettled'> {
    const {editor, identity, fire} = firing();
    const ports = setupPortsOf(editor, {...identity, platform});
    const outcome = ports.argvEdited();
    await new Promise(resolve => setImmediate(resolve));
    for (const [event, documentPath] of events) {
      fire(event, documentPath);
    }
    return Promise.race([
      outcome,
      new Promise<'unsettled'>(resolve => {
        setImmediate(() => {
          resolve('unsettled');
        });
      }),
    ]);
  }

  const ARGV_FILE = '/home/user/.vscode-oss/argv.json';

  it('reports an edit when the resolved argv file is saved and then closed', async () => {
    deepStrictEqual(
      await editAfter([
        ['save', ARGV_FILE],
        ['close', ARGV_FILE],
      ]),
      true,
    );
  });

  it('reports no edit when the resolved argv file is closed unsaved', async () => {
    deepStrictEqual(await editAfter([['close', ARGV_FILE]]), false);
  });

  it('is not settled by a file of the same name elsewhere', async () => {
    deepStrictEqual(
      await editAfter([
        ['save', '/home/user/project/argv.json'],
        ['close', '/home/user/project/argv.json'],
      ]),
      'unsettled',
    );
  });

  it('matches the path in another case on win32', async () => {
    deepStrictEqual(
      await editAfter(
        [
          ['save', '/HOME/User/.VSCODE-OSS/ARGV.JSON'],
          ['close', '/HOME/User/.VSCODE-OSS/ARGV.JSON'],
        ],
        'win32',
      ),
      true,
    );
  });

  it('tells the log once when the argv file cannot be read as JSON', async () => {
    const {editor, identity, logged} = firing();
    editor.readFile = () => Promise.resolve('not json');
    const ports = setupPortsOf(editor, identity);
    deepStrictEqual([await ports.argvEnabled(), logged.length], [[], 1]);
  });

  it('lists nothing and logs once when the data folder cannot be found', async () => {
    const {editor, identity, logged} = firing();
    const ports = setupPortsOf(editor, {
      ...identity,
      argv: {
        ...identity.argv,
        dataFolderName: () => Promise.reject(new Error('product.json is gone')),
      },
    });
    deepStrictEqual(
      [await ports.argvEnabled(), await ports.argvEdited(), logged.length],
      [[], false, 2],
    );
  });
});
