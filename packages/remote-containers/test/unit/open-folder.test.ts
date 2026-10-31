import {deepStrictEqual} from 'node:assert';
import {
  devContainerPayloadOf,
  devContainerTargetOf,
} from '../../src/authority/payload.ts';
import {openFolderInContainer} from '../../src/open/open-folder.ts';
import {pendingOf, settled} from './pending.ts';
import {
  CONFIG,
  FOLDER,
  linesOf,
  portsOf,
  setup,
  type Setup,
  WRITTEN_IN_FOLDER,
} from './reopen.fixture.ts';

/** What the dialog is asked, and what it answers. */
interface Dialog {
  starts: string[];
  answer: {scheme: string; fsPath: string} | undefined;
  /** Holds the dialog until it is released. */
  hold: Promise<void>;
}

/** The window's own authority: a dev container window of `hostPath`. */
function containerAuthority(hostPath: string): string {
  return `dev-container+${devContainerPayloadOf({
    kind: 'folder',
    hostPath,
    localDocker: false,
    configFile: {
      $mid: 1,
      fsPath: `${hostPath}/.devcontainer/devcontainer.json`,
      path: `${hostPath}/.devcontainer/devcontainer.json`,
      scheme: 'file',
    },
  })}`;
}

/** The command over a setup, with a dialog that answers the folder of the setup unless a row changes it. */
function commandOf(state: Setup, authority?: string) {
  const {ports, sink} = portsOf(state);
  const dialog: Dialog = {
    starts: [],
    answer: {scheme: 'file', fsPath: FOLDER},
    hold: Promise.resolve(),
  };
  const handler = openFolderInContainer({
    ...ports,
    window: {
      ...ports.window,
      remoteAuthority: () => authority,
      homeFolder: () => '/home/u',
      isTrusted: () => state.trust === 'trusted',
    },
    pickFolder: async start => {
      dialog.starts.push(start);
      state.calls.push('pickFolder');
      await dialog.hold;
      return dialog.answer;
    },
  });
  return {handler, dialog, sink};
}

/** The dev container target the first command of the setup opened. */
function reloadTargetOf(state: Setup): ReturnType<typeof devContainerTargetOf> {
  const {authority} = state.commands[0]?.parameters[0] as {authority: string};
  return devContainerTargetOf(authority.slice('dev-container+'.length));
}

describe('Open Folder in Container', () => {
  it('F-0403 7.E3, AC-20: the engine check runs before the dialog, and a stop shows no dialog', async () => {
    const state = setup();
    state.folders = [];
    state.check = 'stopped';
    const {handler, dialog} = commandOf(state);
    await handler();
    deepStrictEqual(
      [state.calls, dialog.starts],
      [['firstCheck undefined'], []],
    );
  });

  it('F-0201 AC-55, BR-1: a relative dockerPath is the window folder’s file, so the engine check gets the folder as its base only once the window is trusted', async () => {
    const calls = [];
    for (const trust of ['trusted', 'declined'] as const) {
      const state = setup();
      state.check = 'stopped';
      state.trust = trust;
      await commandOf(state).handler();
      calls.push(state.calls);
    }
    deepStrictEqual(calls, [
      [`firstCheck ${FOLDER}`],
      ['firstCheck undefined'],
    ]);
  });

  it('F-0403 5.0 step 2: the dialog opens at the local window’s folder, at the container’s host folder, or at home', async () => {
    const starts = [];
    for (const [change, authority] of [
      [() => undefined, undefined],
      [
        (state: Setup) => {
          state.remoteName = 'dev-container';
          state.folders = [{scheme: 'vscode-remote', fsPath: '/workspaces/p'}];
        },
        containerAuthority('/host/proj'),
      ],
      [
        (state: Setup) => {
          state.folders = [];
        },
        undefined,
      ],
      [
        (state: Setup) => {
          state.remoteName = 'dev-container';
        },
        'dev-container+7b7d',
      ],
      [
        (state: Setup) => {
          state.remoteName = 'ssh-remote';
        },
        undefined,
      ],
      [
        (state: Setup) => {
          state.folders = [{scheme: 'memfs', fsPath: '/m'}];
        },
        undefined,
      ],
      [
        (state: Setup) => {
          state.folders = [
            {scheme: 'file', fsPath: '/a'},
            {scheme: 'file', fsPath: '/b'},
          ];
        },
        undefined,
      ],
    ] as const) {
      const state = setup();
      change(state);
      const {handler, dialog} = commandOf(state, authority);
      dialog.answer = undefined;
      await handler();
      starts.push(dialog.starts);
    }
    deepStrictEqual(starts, [
      ['/w/p'],
      ['/host/proj'],
      ['/home/u'],
      ['/home/u'],
      ['/home/u'],
      ['/home/u'],
      ['/home/u'],
    ]);
  });

  it('F-0403 7.E5: a cancelled dialog does nothing and says so', async () => {
    const state = setup();
    const {handler, dialog, sink} = commandOf(state);
    dialog.answer = undefined;
    await handler();
    deepStrictEqual(
      [
        state.calls.includes('readConfiguration /w/p'),
        state.commands,
        linesOf(sink),
      ],
      [false, [], ['info: Open Folder in Container was cancelled']],
    );
  });

  it('F-0403 6.1: a folder of another scheme does nothing', async () => {
    const state = setup();
    const {handler, dialog, sink} = commandOf(state);
    dialog.answer = {scheme: 'vscode-remote', fsPath: '/x'};
    await handler();
    deepStrictEqual(
      [state.commands, linesOf(sink)],
      [[], ['info: Open Folder in Container needs a local folder']],
    );
  });

  it('F-0403 7.E1, AC-13: picking the folder the container window shows does nothing and shows nothing', async () => {
    const state = setup();
    state.remoteName = 'dev-container';
    state.folders = [];
    const {handler, dialog, sink} = commandOf(
      state,
      containerAuthority('/w/p'),
    );
    await handler();
    deepStrictEqual(
      [
        dialog.starts,
        state.calls.includes('readConfiguration /w/p'),
        state.commands,
        state.shown,
        linesOf(sink),
      ],
      [
        ['/w/p'],
        false,
        [],
        [],
        ['info: the folder is already open in this container'],
      ],
    );
  });

  it('F-0403 5.1, AC-12: a configured folder reloads the window on its authority through the shared reload, with one engine query', async () => {
    const state = setup();
    state.folders = [];
    const {handler} = commandOf(state);
    await handler();
    await settled();
    const target = reloadTargetOf(state);
    deepStrictEqual(
      [
        state.calls,
        state.commands.map(each => each.command),
        state.commands[0]?.parameters[1],
        'hostPath' in target ? target.hostPath : target,
        'configFile' in target ? target.configFile.fsPath : target,
      ],
      [
        [
          'firstCheck undefined',
          'pickFolder',
          'readConfiguration /w/p',
          'currentContext',
        ],
        ['vscode.openFolder'],
        {forceNewWindow: false, forceReuseWindow: true},
        '/w/p',
        CONFIG,
      ],
    );
  });

  it('F-0403 5.1: no configuration runs the wizard for the folder, and a wizard that ends without a write reloads nothing', async () => {
    const state = setup();
    state.existing = [];
    const {handler, sink} = commandOf(state);
    await handler();
    deepStrictEqual(
      [
        state.commands,
        state.calls.filter(call => call.startsWith('wizard')),
        linesOf(sink).slice(-1),
      ],
      [
        [],
        ['wizard /w/p'],
        ['info: Open Folder in Container found no configuration in /w/p'],
      ],
    );
  });

  it('F-0403 AC-23: a written configuration is read and the window reloads on it, with no notice shown, and no trust asked first (ruling 2)', async () => {
    const state = setup();
    state.existing = [];
    state.wizard = WRITTEN_IN_FOLDER;
    state.wizardLeaves = [CONFIG];
    const {handler} = commandOf(state);
    await handler();
    deepStrictEqual(
      [
        state.commands.map(each => each.command),
        state.shown,
        state.calls.includes('ensureTrusted'),
      ],
      [['vscode.openFolder'], [], false],
    );
  });

  it('F-0403 AC-4: a configuration written to the store of user data is the one the window reloads on: the container’s configuration is that file, and the folder stays the opened one', async () => {
    const stored = '/store/configs/p/.devcontainer/devcontainer.json';
    const state = setup();
    state.existing = [];
    state.wizard = {
      kind: 'written',
      files: ['.devcontainer/devcontainer.json'],
      target: '/store/configs/p',
      place: 'userData',
    };
    state.contents[stored] = '{"image":"i"}';
    const {handler} = commandOf(state);
    await handler();
    await settled();
    const target = reloadTargetOf(state);
    deepStrictEqual(
      [
        state.calls.filter(call => call.startsWith('readConfiguration')),
        'hostPath' in target ? target.hostPath : target,
        'configFile' in target ? target.configFile.fsPath : target,
      ],
      [['readConfiguration /w/p'], '/w/p', stored],
    );
  });

  it('F-0403 6.1: a dismissed picker reloads nothing', async () => {
    const state = setup();
    state.existing = [CONFIG, '/w/p/.devcontainer.json'];
    state.pick = {kind: 'dismissed'};
    const {handler} = commandOf(state);
    await handler();
    deepStrictEqual(state.commands, []);
  });

  it('F-0403: a second call while one runs does nothing, and a call after it ends runs again', async () => {
    const state = setup();
    const release = pendingOf<undefined>();
    const {handler, dialog, sink} = commandOf(state);
    dialog.hold = release.promise;
    const first = handler();
    await settled();
    await handler();
    const during = [...dialog.starts];
    release.resolve(undefined);
    await first;
    await handler();
    deepStrictEqual(
      [
        during,
        dialog.starts.length,
        linesOf(sink).filter(line => line.includes('already running')),
      ],
      [['/w/p'], 2, ['info: Open Folder in Container is already running']],
    );
  });

  it('F-0101 AC-15: without resolvers the command calls nothing but setupAgain, before the engine check', async () => {
    const state = setup();
    state.missing = ['resolvers'];
    state.missingAfter = ['resolvers'];
    const {handler, dialog, sink} = commandOf(state);
    await handler();
    deepStrictEqual(
      [state.calls, dialog.starts, linesOf(sink)],
      [
        ['setupAgain'],
        [],
        [
          'info: Open Folder in Container needs the proposed API: resolvers; the window stays as it is',
        ],
      ],
    );
  });
});
