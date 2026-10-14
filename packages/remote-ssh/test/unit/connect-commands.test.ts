import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import type {CommandHandler} from 'lib-identifiers';
import type {HostListResult, SshTarget} from 'lib-ssh';
import {
  type ConnectCommandConnection,
  type ConnectCommandEditor,
  connectCommandHandlers,
} from '../../src/connect/connect-commands.ts';
import {
  type PickerItem,
  type PickerModel,
  pickerModel,
} from '../../src/connect/picker-model.ts';
import type {WindowTarget} from '../../src/connect/window-target.ts';

const HOSTS: HostListResult = {
  hosts: [
    {name: 'dev', file: '/home/alex/.ssh/config'},
    {name: 'Upper-Alias', file: '/home/alex/.ssh/config'},
  ],
};

/** What the fake editor was asked, in order, and what the user does at the pick. */
interface Fakes {
  editor: ConnectCommandEditor;
  connection: ConnectCommandConnection;
  asked: string[];
  opened: Array<[string, WindowTarget]>;
  killed: string[];
  commandsRun: string[];
  /** The model function the pick was given. */
  modelOf: Array<(typedText: string) => PickerModel>;
  initial: PickerModel[];
}

/** The row of a pick with `typedText` over `HOSTS`: a listed or typed row by its label, a fixed row by its kind. */
function rowFor(typedText: string, which: string): PickerItem {
  const model = pickerModel(HOSTS, typedText);
  const item =
    'items' in model
      ? model.items.find(
          each =>
            each.kind === which ||
            ('label' in each &&
              typeof each.label === 'string' &&
              each.label === which),
        )
      : undefined;
  if (item === undefined) {
    throw new Error(`no row ${which}`);
  }
  return item;
}

/** The fakes: the user picks `pick` (or Escapes with nothing), the window's connection is `current`. */
function runWith(
  pick: PickerItem | undefined,
  options: {
    listing?: HostListResult;
    remoteName?: string;
    current?: {target: SshTarget; state: string};
  } = {},
): Fakes {
  const fakes: Fakes = {
    asked: [],
    opened: [],
    killed: [],
    commandsRun: [],
    modelOf: [],
    initial: [],
    editor: {
      listHosts: () => {
        fakes.asked.push('listHosts');
        return options.listing ?? HOSTS;
      },
      pickHost: (initial, modelOf) => {
        fakes.asked.push('pickHost');
        fakes.initial.push(initial);
        fakes.modelOf.push(modelOf);
        return Promise.resolve(pick);
      },
      openRemote: (authority, window) => {
        fakes.opened.push([authority, window]);
        return Promise.resolve();
      },
      runCommand: command => {
        fakes.commandsRun.push(command);
        return Promise.resolve();
      },
      switchToLocalWindow: () => Promise.resolve(),
      remoteName: () => options.remoteName,
    },
    connection: {
      killLocalServer: hostString => {
        fakes.killed.push(hostString);
        return Promise.resolve();
      },
      current: () => options.current,
    },
  };
  return fakes;
}

/** The hex of a compact JSON host, as the authority carries it. */
function hexOf(host: object): string {
  return Buffer.from(JSON.stringify(host), 'utf8').toString('hex');
}

describe('Connect to Host... (card connect-21)', () => {
  it('connect-21: a picked host opens its alias in a new window', async () => {
    const fakes = runWith(rowFor('', 'dev'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(fakes.opened, [['ssh-remote+dev', 'new']]);
  });

  it('connect-21: the current-window command opens the picked host here', async () => {
    const fakes = runWith(rowFor('', 'dev'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowInCurrentWindow.execute();
    deepStrictEqual(fakes.opened, [['ssh-remote+dev', 'current']]);
  });

  it('connect-21: a picked alias with an upper-case letter opens its encoded authority', async () => {
    const fakes = runWith(rowFor('', 'Upper-Alias'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(fakes.opened, [
      [`ssh-remote+${hexOf({hostName: 'Upper-Alias'})}`, 'new'],
    ]);
  });

  it('connect-21: a typed user@host opens the authority with the user', async () => {
    const fakes = runWith(rowFor('lab@host.invalid', '➤ lab@host.invalid'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(fakes.opened, [
      [`ssh-remote+${hexOf({hostName: 'host.invalid', user: 'lab'})}`, 'new'],
    ]);
  });

  it('connect-21: a typed host with a port opens the authority with the port as a number', async () => {
    const fakes = runWith(rowFor('host.invalid:2222', '➤ host.invalid:2222'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(fakes.opened, [
      [`ssh-remote+${hexOf({hostName: 'host.invalid', port: 2222})}`, 'new'],
    ]);
  });

  it('connect-21: a host argument opens without a pick', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute({host: 'dev'});
    deepStrictEqual(
      [fakes.opened, fakes.asked],
      [[['ssh-remote+dev', 'new']], []],
    );
  });

  it('connect-21: a host argument of the current-window command opens here', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowInCurrentWindow.execute({host: 'dev'});
    deepStrictEqual(fakes.opened, [['ssh-remote+dev', 'current']]);
  });

  it('connect-21: a host argument is never split, and keeps its case', async () => {
    const fakes = runWith(undefined);
    const handler = connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow;
    await handler.execute({host: 'lab@x.invalid:2222'});
    await handler.execute({host: 'UPPER-Alias'});
    deepStrictEqual(fakes.opened, [
      ['ssh-remote+lab@x.invalid:2222', 'new'],
      [`ssh-remote+${hexOf({hostName: 'UPPER-Alias'})}`, 'new'],
    ]);
  });

  it('connect-21: an empty host argument opens the empty authority', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute({host: ''});
    deepStrictEqual(fakes.opened, [['ssh-remote+', 'new']]);
  });

  it('connect-21: an argument without a host opens the pick', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute({});
    deepStrictEqual(fakes.asked, ['listHosts', 'pickHost']);
  });

  it('connect-21: Escape opens nothing and runs nothing', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual([fakes.opened, fakes.commandsRun], [[], []]);
  });

  it('connect-21: the configure row runs the configuration file command and opens nothing', async () => {
    const fakes = runWith(rowFor('', 'configure'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(
      [fakes.commandsRun, fakes.opened],
      [['opensshremotes.openConfigFile'], []],
    );
  });

  it('connect-21: the add row runs the add-host command and opens nothing', async () => {
    const fakes = runWith(rowFor('', 'addHost'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(
      [fakes.commandsRun, fakes.opened],
      [['opensshremotes.addNewSshHost'], []],
    );
  });

  it('connect-21: the pick starts from the rows of an empty text over the listed hosts', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(fakes.initial, [pickerModel(HOSTS, '')]);
  });

  it('connect-21: the pick is rebuilt for each typed text over the same listing', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    deepStrictEqual(fakes.modelOf[0]?.('dev'), pickerModel(HOSTS, 'dev'));
  });

  it('connect-21: the files are read once for a command, not for each typed text', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindow.execute();
    fakes.modelOf[0]?.('d');
    fakes.modelOf[0]?.('de');
    deepStrictEqual(fakes.asked, ['listHosts', 'pickHost']);
  });

  it('F-2201 AC-19: a configuration file that cannot be parsed shows no pick and fails with the parser message', async () => {
    const fakes = runWith(undefined, {
      listing: {
        parseError: {
          file: '/home/alex/.ssh/config',
          reason: 'Unexpected line break',
        },
      },
    });
    const message = await connectCommandHandlers(fakes.editor, fakes.connection)
      .openEmptyWindow.execute()
      .then(
        () => 'completed',
        (caught: unknown) => (caught as Error).message,
      );
    deepStrictEqual(
      [message, fakes.asked],
      ['/home/alex/.ssh/config: Unexpected line break', ['listHosts']],
    );
  });

  it("connect-21: a refused open fails the command with the editor's reason", async () => {
    const fakes = runWith(rowFor('', 'dev'));
    fakes.editor.openRemote = () => Promise.reject(new Error('refused'));
    await rejects(
      connectCommandHandlers(
        fakes.editor,
        fakes.connection,
      ).openEmptyWindow.execute(),
      {message: 'refused'},
    );
  });
});

describe('Connect to the active host (card connect-21)', () => {
  const CONNECTED = {target: {host: 'dev', port: 22}, state: 'connected'};

  it('connect-21: a connected ssh window opens its host in a new window, the port 22 left out', async () => {
    const fakes = runWith(undefined, {
      remoteName: 'ssh-remote',
      current: CONNECTED,
    });
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowOnCurrentHost.execute();
    deepStrictEqual(fakes.opened, [['ssh-remote+dev', 'new']]);
  });

  it('connect-21: the user and a port other than 22 stay in the authority', async () => {
    const fakes = runWith(undefined, {
      remoteName: 'ssh-remote',
      current: {
        target: {host: 'dev', user: 'lab', port: 2222},
        state: 'connected',
      },
    });
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowOnCurrentHost.execute();
    deepStrictEqual(fakes.opened, [
      [
        `ssh-remote+${hexOf({hostName: 'dev', user: 'lab', port: 2222})}`,
        'new',
      ],
    ]);
  });

  it('connect-21: no pick is shown', async () => {
    const fakes = runWith(undefined, {
      remoteName: 'ssh-remote',
      current: CONNECTED,
    });
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowOnCurrentHost.execute();
    deepStrictEqual(fakes.asked, []);
  });

  it('connect-21: a window with no connection opens nothing', async () => {
    const fakes = runWith(undefined, {remoteName: 'ssh-remote'});
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowOnCurrentHost.execute();
    deepStrictEqual(fakes.opened, []);
  });

  it('connect-21: a local window opens nothing', async () => {
    const fakes = runWith(undefined, {current: CONNECTED});
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowOnCurrentHost.execute();
    deepStrictEqual(fakes.opened, []);
  });

  it('connect-21: a connection that is not connected opens nothing', async () => {
    const fakes = runWith(undefined, {
      remoteName: 'ssh-remote',
      current: {target: {host: 'dev'}, state: 'resolving'},
    });
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowOnCurrentHost.execute();
    deepStrictEqual(fakes.opened, []);
  });

  it('F-2303 AC-19: an argument never names another host', async () => {
    const fakes = runWith(undefined, {
      remoteName: 'ssh-remote',
      current: CONNECTED,
    });
    const handler: CommandHandler = connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).openEmptyWindowOnCurrentHost;
    await handler.execute('other');
    await handler.execute({host: 'other'});
    deepStrictEqual(fakes.opened, [
      ['ssh-remote+dev', 'new'],
      ['ssh-remote+dev', 'new'],
    ]);
  });
});

describe('Kill Local Connection Server (card connect-21)', () => {
  it("connect-21: the picked host's server is killed by its host string", async () => {
    const fakes = runWith(rowFor('', 'dev'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).cleanLocalServer.execute();
    deepStrictEqual(fakes.killed, ['dev']);
  });

  it('F-2102 AC-17: a typed user@address and an alias reach the kill as two different strings', async () => {
    const typed = runWith(rowFor('alex@10.0.0.5', '➤ alex@10.0.0.5'));
    const alias = runWith(rowFor('', 'dev'));
    await connectCommandHandlers(
      typed.editor,
      typed.connection,
    ).cleanLocalServer.execute();
    await connectCommandHandlers(
      alias.editor,
      alias.connection,
    ).cleanLocalServer.execute();
    deepStrictEqual(
      [
        typed.killed.length,
        alias.killed.length,
        typed.killed[0] === alias.killed[0],
      ],
      [1, 1, false],
    );
  });

  it('F-2102 AC-31: the string killed for a typed user@address is the payload of the authority the same pick opens', async () => {
    const kill = runWith(rowFor('alex@10.0.0.5', '➤ alex@10.0.0.5'));
    const open = runWith(rowFor('alex@10.0.0.5', '➤ alex@10.0.0.5'));
    await connectCommandHandlers(
      kill.editor,
      kill.connection,
    ).cleanLocalServer.execute();
    await connectCommandHandlers(
      open.editor,
      open.connection,
    ).openEmptyWindow.execute();
    strictEqual(`ssh-remote+${kill.killed[0] ?? ''}`, open.opened[0]?.[0]);
  });

  it('F-2102 AC-6: the kill shows nothing and runs no command and opens no window', async () => {
    const fakes = runWith(rowFor('', 'dev'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).cleanLocalServer.execute();
    deepStrictEqual([fakes.commandsRun, fakes.opened], [[], []]);
  });

  it('F-2102 AC-5: Escape ends no server', async () => {
    const fakes = runWith(undefined);
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).cleanLocalServer.execute();
    deepStrictEqual(fakes.killed, []);
  });

  it('F-2102 AC-18: the configure row ends no server and runs the configuration file command', async () => {
    const fakes = runWith(rowFor('', 'configure'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).cleanLocalServer.execute();
    deepStrictEqual(
      [fakes.killed, fakes.commandsRun],
      [[], ['opensshremotes.openConfigFile']],
    );
  });

  it('F-2102 AC-18: the add row ends no server and runs the add-host command', async () => {
    const fakes = runWith(rowFor('', 'addHost'));
    await connectCommandHandlers(
      fakes.editor,
      fakes.connection,
    ).cleanLocalServer.execute();
    deepStrictEqual(
      [fakes.killed, fakes.commandsRun],
      [[], ['opensshremotes.addNewSshHost']],
    );
  });

  it('F-2201 AC-19: a configuration file that cannot be parsed shows no pick and ends no server', async () => {
    const fakes = runWith(undefined, {
      listing: {parseError: {file: '/f', reason: 'r'}},
    });
    const message = await connectCommandHandlers(fakes.editor, fakes.connection)
      .cleanLocalServer.execute()
      .then(
        () => 'completed',
        (caught: unknown) => (caught as Error).message,
      );
    deepStrictEqual(
      [message, fakes.asked, fakes.killed],
      ['/f: r', ['listHosts'], []],
    );
  });
});
