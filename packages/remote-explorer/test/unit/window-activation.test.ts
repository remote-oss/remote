import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {SSH_COMPANION_ID} from 'lib-companion';
import {commands} from '../../src/identifiers.generated.ts';
import {
  activateInWindow,
  type WindowEditor,
} from '../../src/window-activation.ts';

const REFERENCE_ID = 'ms-vscode.remote-explorer';
const PULL = 'remote-internal.getActiveSshRemote';
const HOSTS = 'remote-internal.getConfiguredHostnames';
const OPEN = 'remote-internal.openRemoteSshTarget';
const HISTORY = 'remote-internal.getSshFoldersHistory';
const DELETE = 'remote-internal.deleteSshFolderFromHistory';
const VERSION = {major: 1, minor: 0};

interface EditorOptions {
  referencePresent?: boolean;
  focusListed?: boolean;
  /** The user values the editor reports for the two folder settings, by key. */
  userValues?: Record<string, unknown>;
  /** Whether the SSH companion is installed; true when absent. */
  companionPresent?: boolean;
  /** The commands of the companion that reject when run. */
  rejecting?: string[];
}

interface Registered {
  commandId: string;
  callback: (...commandArguments: unknown[]) => unknown;
}

interface Fixture {
  editor: WindowEditor;
  events: string[];
  registered: Registered[];
  /** The tree data providers the editor was given, in order. */
  providers: Array<vscode.TreeDataProvider<unknown>>;
  /** The arguments of the open requests the bus saw. */
  opened: unknown[];
  /** The arguments of the delete requests the bus saw. */
  deleted: unknown[];
  /** The commands of the companion that were run, each with its arguments. */
  handed: Array<[string, unknown[]]>;
}

class FakeEmitter {
  event = (): {dispose(): void} => ({dispose: () => undefined});
  fire(): void {
    return undefined;
  }
  dispose(): void {
    return undefined;
  }
}

/** The editor as far as the window's activation reads it, writing what happens to a list. */
function fixtureOf(options: EditorOptions): Fixture {
  const events: string[] = [];
  const registered: Registered[] = [];
  const providers: Fixture['providers'] = [];
  const opened: unknown[] = [];
  const deleted: unknown[] = [];
  const handed: Fixture['handed'] = [];
  const editor = {
    extensions: {
      getExtension: (extensionId: string) =>
        (extensionId === SSH_COMPANION_ID &&
          options.companionPresent !== false) ||
        (extensionId === REFERENCE_ID && options.referencePresent === true)
          ? {}
          : undefined,
      onDidChange: () => {
        events.push('watch extensions');
        return {dispose: () => undefined};
      },
    },
    commands: {
      executeCommand: (command: string, ...commandArguments: unknown[]) => {
        if (command === PULL) {
          events.push('ask pull');
          return Promise.resolve({
            interfaceVersion: VERSION,
            connected: false,
          });
        }
        if (command === HOSTS) {
          events.push('ask hosts');
          return Promise.resolve({
            interfaceVersion: VERSION,
            hostnames: ['harness'],
          });
        }
        if (command === HISTORY) {
          events.push('ask history');
          return Promise.resolve({
            interfaceVersion: VERSION,
            hosts: [
              {
                hostKey: 'harness',
                entries: [
                  {path: '/w/team.code-workspace', kind: 'folder'},
                  {path: '/w/proj', kind: 'workspace'},
                  {path: '/w/proj', kind: 'folder'},
                ],
              },
              {
                hostKey: 'unknown',
                entries: [{path: '/w/none', kind: 'folder'}],
              },
            ],
          });
        }
        if (command === OPEN) {
          opened.push(commandArguments[0]);
          return Promise.resolve({interfaceVersion: VERSION});
        }
        if (command === DELETE) {
          deleted.push(commandArguments[0]);
          return Promise.resolve({interfaceVersion: VERSION, changed: true});
        }
        if (command.startsWith('opensshremotes.')) {
          handed.push([command, commandArguments]);
          return options.rejecting?.includes(command) === true
            ? Promise.reject(new Error('rejected'))
            : Promise.resolve();
        }
        events.push(`${command} ${commandArguments.join(' ')}`);
        return Promise.resolve();
      },
      registerCommand: (
        commandId: string,
        callback: Registered['callback'],
      ) => {
        events.push(`register ${commandId}`);
        registered.push({commandId, callback});
        return {
          dispose: () => {
            events.push(`unregister ${commandId}`);
          },
        };
      },
      getCommands: () =>
        Promise.resolve(
          options.focusListed === false ? [] : ['remoteTargets.focus'],
        ),
    },
    window: {
      showWarningMessage: (text: string, button: string) => {
        events.push(`warning ${text} | ${button}`);
        return Promise.resolve(undefined);
      },
      showInformationMessage: () => Promise.resolve(undefined),
      createTreeView: (
        viewId: string,
        options: vscode.TreeViewOptions<unknown>,
      ) => {
        events.push('tree view');
        providers.push(options.treeDataProvider);
        return {
          dispose: () => {
            events.push('tree view disposed');
          },
        };
      },
    },
    workspace: {
      getConfiguration: () => ({
        inspect: (key: string) =>
          key in (options.userValues ?? {})
            ? {globalValue: options.userValues?.[key]}
            : undefined,
      }),
      onDidChangeConfiguration: () => ({dispose: () => undefined}),
    },
    l10n: {t: (template: string) => template},
    EventEmitter: FakeEmitter,
  };
  return {
    editor: editor as unknown as WindowEditor,
    events,
    registered,
    providers,
    opened,
    deleted,
    handed,
  };
}

interface Context {
  subscriptions: Array<{dispose(): unknown}>;
  extension: {packageJSON: unknown};
}

function contextOf(): Context {
  return {subscriptions: [], extension: {packageJSON: {displayName: 'X'}}};
}

async function activated(
  options: EditorOptions,
): Promise<Fixture & {context: Context}> {
  const fixture = fixtureOf(options);
  const context = contextOf();
  await activateInWindow(
    fixture.editor,
    context as never,
    () => {
      fixture.events.push('setup');
      return Promise.resolve();
    },
    'other',
  );
  return {...fixture, context};
}

function commandOf(
  fixture: Fixture,
  commandId: string,
): Registered['callback'] | undefined {
  return fixture.registered.find(entry => entry.commandId === commandId)
    ?.callback;
}

function refreshOf(fixture: Fixture): Registered['callback'] | undefined {
  return commandOf(fixture, commands.refresh.id);
}

const COMMAND_IDS = Object.values(commands).map(entry => entry.id);

const INBOX = {
  setActiveFolders: 'remote-internal.setActiveFolders',
  sshHostsChanged: 'remote-internal.sshHostsChanged',
};

const OPEN_CONFIG = 'opensshremotes.openConfigFile';
const ADD_HOST = 'opensshremotes.addNewSshHost';

describe('the activation of a window (card explorer-03c)', () => {
  it('F-5001.BR-10: where the other runs, the key is set and the warning shows, and nothing else happens', async () => {
    const scenario = await activated({referencePresent: true});
    deepStrictEqual(
      [
        scenario.events.length,
        scenario.events[0],
        scenario.context.subscriptions.length,
      ],
      [2, 'setContext remote-explorer.standingDown true', 0],
    );
  });

  it('F-5001.BR-11: where the other does not scenario, the key is cleared, setup runs, then the commands are registered and the entry added before the view', async () => {
    const scenario = await activated({});
    deepStrictEqual(scenario.events.slice(0, 2 + COMMAND_IDS.length), [
      'setContext remote-explorer.standingDown false',
      'setup',
      ...COMMAND_IDS.map(commandId => `register ${commandId}`),
    ]);
  });

  it('F-5001.BR-11: disposing the entries disposes the registrations, the view and the detector', async () => {
    const scenario = await activated({});
    scenario.events.length = 0;
    for (const subscription of scenario.context.subscriptions) {
      subscription.dispose();
    }
    deepStrictEqual(scenario.events, [
      ...COMMAND_IDS.map(commandId => `unregister ${commandId}`),
      `unregister ${INBOX.setActiveFolders}`,
      `unregister ${INBOX.sshHostsChanged}`,
      'tree view disposed',
    ]);
  });

  it('F-5902.AC-25: with the setup of the web entry the commands are registered and nothing is warned', async () => {
    const fixture = fixtureOf({});
    await activateInWindow(
      fixture.editor,
      contextOf() as never,
      () => Promise.resolve(),
      'other',
    );
    deepStrictEqual(
      fixture.events.filter(event => event.startsWith('warning')),
      [],
    );
  });

  it('F-5101.BR-9: serving with the focus command shows the tree once and asks the pull, then the hosts, once', async () => {
    const scenario = await activated({});
    await Promise.resolve();
    deepStrictEqual(
      [
        scenario.events.filter(event => event === 'tree view').length,
        scenario.events.filter(event => event.startsWith('ask ')),
        scenario.context.subscriptions.length,
      ],
      [1, ['ask pull', 'ask history', 'ask hosts'], 3],
    );
  });

  it('F-5101.BR-7: the refresh command resolves undefined and asks both questions again', async () => {
    const scenario = await activated({});
    const outcome = await refreshOf(scenario)?.();
    deepStrictEqual(
      [outcome, scenario.events.filter(event => event.startsWith('ask '))],
      [
        undefined,
        [
          'ask pull',
          'ask history',
          'ask hosts',
          'ask pull',
          'ask history',
          'ask hosts',
        ],
      ],
    );
  });

  it('F-5901.AC-19: F-5001.BR-10: where the other runs, there is no tree, no watching of extensions and no question', async () => {
    const scenario = await activated({referencePresent: true});
    deepStrictEqual(
      scenario.events.filter(
        event =>
          event === 'tree view' ||
          event === 'watch extensions' ||
          event.startsWith('ask '),
      ),
      [],
    );
  });

  it('F-5101.7.E5: serving without the focus command shows no tree and asks nothing, and refresh does nothing', async () => {
    const scenario = await activated({focusListed: false});
    const outcome = await refreshOf(scenario)?.();
    deepStrictEqual(
      [
        outcome,
        scenario.events.filter(
          event => event === 'tree view' || event.startsWith('ask '),
        ),
      ],
      [undefined, []],
    );
  });

  it('F-5103.BR-1: the connect command of the current window, given the host node of the tree, asks the companion to open the host', async () => {
    const scenario = await activated({});
    await Promise.resolve();
    const provider = scenario.providers[0];
    const [group] = [...((await provider?.getChildren(undefined)) ?? [])];
    const [host] = [...((await provider?.getChildren(group)) ?? [])];
    await commandOf(
      scenario,
      commands.connectToRemoteInCurrentWindow.id,
    )?.(host);
    deepStrictEqual(scenario.opened, [
      {interfaceVersion: VERSION, hostKey: 'harness', window: 'current'},
    ]);
  });

  it('F-5002.19.7: the connect command of a new window with no argument resolves undefined and opens nothing', async () => {
    const scenario = await activated({});
    const outcome = await commandOf(
      scenario,
      commands.connectToRemoteInNewWindow.id,
    )?.();
    deepStrictEqual([outcome, scenario.opened], [undefined, []]);
  });

  /** The host node and its folder nodes the tree gives, once the first build settled. */
  async function treeOf(fixture: Fixture) {
    await Promise.resolve();
    const provider = fixture.providers[0];
    const [group] = [...((await provider?.getChildren(undefined)) ?? [])];
    const [host] = [...((await provider?.getChildren(group)) ?? [])];
    const folders = [...((await provider?.getChildren(host)) ?? [])];
    return {provider, host, folders};
  }

  /** The group node the tree gives, once the first build settled. */
  async function groupOf(fixture: Fixture) {
    await Promise.resolve();
    const [group] = [
      ...((await fixture.providers[0]?.getChildren(undefined)) ?? []),
    ];
    return {group};
  }

  it('F-5104.BR-1, BR-2, BR-3: the host the history names has one folder row per entry, repeats kept, and the key that names no host shows nowhere', async () => {
    const scenario = await activated({});
    const {folders} = await treeOf(scenario);
    deepStrictEqual(
      folders.map(node => (node as {folderRow: {path: string}}).folderRow.path),
      ['/w/team.code-workspace', '/w/proj', '/w/proj'],
    );
  });

  it('F-5104.BR-15: the folder commands open the path with the kind the path rule gives, whatever kind the history entry carries', async () => {
    const scenario = await activated({});
    const {folders} = await treeOf(scenario);
    await commandOf(
      scenario,
      commands.connectToFolderInCurrentWindow.id,
    )?.(folders[0]);
    await commandOf(
      scenario,
      commands.connectToFolderInNewWindow.id,
    )?.(folders[1]);
    deepStrictEqual(scenario.opened, [
      {
        interfaceVersion: VERSION,
        hostKey: 'harness',
        path: '/w/team.code-workspace',
        kind: 'workspace',
        window: 'current',
      },
      {
        interfaceVersion: VERSION,
        hostKey: 'harness',
        path: '/w/proj',
        kind: 'folder',
        window: 'new',
      },
    ]);
  });

  it('F-5104.BR-13: Remove from Recent List deletes the path under its host and drops every copy from the tree at once', async () => {
    const scenario = await activated({});
    const {provider, host, folders} = await treeOf(scenario);
    await commandOf(
      scenario,
      commands.deleteFolderHistoryItem.id,
    )?.(folders[1]);
    deepStrictEqual(
      [
        scenario.deleted,
        [...((await provider?.getChildren(host)) ?? [])].length,
        scenario.events.filter(event => event.startsWith('ask history')).length,
      ],
      [
        [{interfaceVersion: VERSION, hostKey: 'harness', path: '/w/proj'}],
        3,
        1,
      ],
    );
  });

  it('F-5104.BR-5, BR-6: only the user value alphabetical sorts the rows', async () => {
    const scenario = await activated({
      userValues: {'remote-explorer.foldersSortOrder': 'alphabetical'},
    });
    const {folders} = await treeOf(scenario);
    deepStrictEqual(
      folders.map(node => (node as {folderRow: {path: string}}).folderRow.path),
      ['/w/proj', '/w/proj', '/w/team.code-workspace'],
    );
  });

  it('F-5102.AC-1, AC-2: the group row hands over to the two commands of the companion, each with no argument', async () => {
    const scenario = await activated({});
    const {group} = await groupOf(scenario);
    await commandOf(scenario, commands.configureSsh.id)?.(group);
    await commandOf(scenario, commands.remoteExplorerAdd.id)?.(group);
    deepStrictEqual(scenario.handed, [
      [OPEN_CONFIG, []],
      [ADD_HOST, []],
    ]);
  });

  it('F-5102.BR-12: F-5902.AC-22: a hand-over the companion rejects resolves undefined and shows nothing', async () => {
    const scenario = await activated({rejecting: [OPEN_CONFIG, ADD_HOST]});
    const {group} = await groupOf(scenario);
    scenario.events.length = 0;
    const outcomes = [
      await commandOf(scenario, commands.configureSsh.id)?.(group),
      await commandOf(scenario, commands.remoteExplorerAdd.id)?.(group),
    ];
    deepStrictEqual([outcomes, scenario.events], [[undefined, undefined], []]);
  });

  it('F-5102.7.E7: without the companion neither hand-over runs', async () => {
    const scenario = await activated({companionPresent: false});
    const lookAlike = {kind: 'sshGroup'};
    await commandOf(scenario, commands.configureSsh.id)?.(lookAlike);
    await commandOf(scenario, commands.remoteExplorerAdd.id)?.(lookAlike);
    deepStrictEqual(scenario.handed, []);
  });

  it('F-5102.AC-15: an argument that is not the SSH group row runs neither hand-over', async () => {
    const scenario = await activated({});
    const {host} = await treeOf(scenario);
    for (const argument of [undefined, 'x', {}, host]) {
      await commandOf(scenario, commands.configureSsh.id)?.(argument);
      await commandOf(scenario, commands.remoteExplorerAdd.id)?.(argument);
    }
    deepStrictEqual(scenario.handed, []);
  });

  it('F-5902.AC-30: setActiveFolders is served and does nothing with any outcome', async () => {
    const scenario = await activated({});
    await Promise.resolve();
    const asked = scenario.events.length;
    const outcomes = [];
    for (const outcome of ['connected', 'failed', 'none']) {
      outcomes.push(
        await commandOf(
          scenario,
          INBOX.setActiveFolders,
        )?.({
          interfaceVersion: VERSION,
          outcome,
        }),
      );
    }
    deepStrictEqual(
      [outcomes, scenario.events.length - asked],
      [[undefined, undefined, undefined], 0],
    );
  });

  it('F-5001.AC-11: setActiveFolders given no argument or a foreign one is silent', async () => {
    const scenario = await activated({});
    await Promise.resolve();
    const asked = scenario.events.length;
    const outcomes = [
      await commandOf(scenario, INBOX.setActiveFolders)?.(),
      await commandOf(scenario, INBOX.setActiveFolders)?.({outcome: 'none'}),
      await commandOf(scenario, INBOX.setActiveFolders)?.('x'),
    ];
    deepStrictEqual(
      [outcomes, scenario.events.length - asked],
      [[undefined, undefined, undefined], 0],
    );
  });

  it('F-5902.AC-9, AC-29: each sshHostsChanged reads the host list once, and the folder rows keep the last history', async () => {
    const scenario = await activated({});
    const {folders} = await treeOf(scenario);
    const before = scenario.events.filter(event => event.startsWith('ask '));
    for (let call = 0; call < 2; call++) {
      await commandOf(
        scenario,
        INBOX.sshHostsChanged,
      )?.({
        interfaceVersion: VERSION,
      });
      await Promise.resolve();
    }
    const {folders: kept} = await treeOf(scenario);
    deepStrictEqual(
      [
        scenario.events
          .filter(event => event.startsWith('ask '))
          .slice(before.length),
        kept.length,
        folders.length,
      ],
      [['ask hosts', 'ask hosts'], 3, 3],
    );
  });

  it('F-5902.AC-9: sshHostsChanged given no argument or a foreign one reads nothing', async () => {
    const scenario = await activated({});
    await treeOf(scenario);
    const asked = scenario.events.length;
    await commandOf(scenario, INBOX.sshHostsChanged)?.();
    await commandOf(scenario, INBOX.sshHostsChanged)?.({});
    deepStrictEqual(scenario.events.length - asked, 0);
  });

  it('F-5101.7.E5: the inbox is served and reads nothing when the view is not shown', async () => {
    const scenario = await activated({focusListed: false});
    const outcomes = [
      await commandOf(
        scenario,
        INBOX.setActiveFolders,
      )?.({
        interfaceVersion: VERSION,
        outcome: 'none',
      }),
      await commandOf(
        scenario,
        INBOX.sshHostsChanged,
      )?.({
        interfaceVersion: VERSION,
      }),
    ];
    deepStrictEqual(
      [outcomes, scenario.events.filter(event => event.startsWith('ask '))],
      [[undefined, undefined], []],
    );
  });

  it('F-5901.AC-19: where the other runs, the inbox is not served', async () => {
    const scenario = await activated({referencePresent: true});
    deepStrictEqual(
      [INBOX.setActiveFolders, INBOX.sshHostsChanged].map(commandId =>
        commandOf(scenario, commandId),
      ),
      [undefined, undefined],
    );
  });
});
