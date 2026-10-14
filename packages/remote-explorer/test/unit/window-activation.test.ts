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
const VERSION = {major: 1, minor: 0};

interface EditorOptions {
  referencePresent?: boolean;
  focusListed?: boolean;
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
  const editor = {
    extensions: {
      getExtension: (extensionId: string) =>
        extensionId === SSH_COMPANION_ID ||
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
        if (command === OPEN) {
          opened.push(commandArguments[0]);
          return Promise.resolve({interfaceVersion: VERSION});
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
      getConfiguration: () => ({inspect: () => undefined}),
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
  await activateInWindow(fixture.editor, context as never, () => {
    fixture.events.push('setup');
    return Promise.resolve();
  });
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
      'tree view disposed',
    ]);
  });

  it('F-5902.AC-25: with the setup of the web entry the commands are registered and nothing is warned', async () => {
    const fixture = fixtureOf({});
    await activateInWindow(fixture.editor, contextOf() as never, () =>
      Promise.resolve(),
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
      [1, ['ask pull', 'ask hosts'], 2],
    );
  });

  it('F-5101.BR-7: the refresh command resolves undefined and asks both questions again', async () => {
    const scenario = await activated({});
    const outcome = await refreshOf(scenario)?.();
    deepStrictEqual(
      [outcome, scenario.events.filter(event => event.startsWith('ask '))],
      [undefined, ['ask pull', 'ask hosts', 'ask pull', 'ask hosts']],
    );
  });

  it('F-5001.BR-10: where the other runs, there is no tree, no watching of extensions and no question', async () => {
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
});
