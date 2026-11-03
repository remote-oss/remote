import {deepStrictEqual} from 'node:assert';
import {
  devContainerPayloadOf,
  devContainerTargetOf,
} from '../../src/authority/payload.ts';
import type {LastResolve} from 'lib-authority';
import {switchContainer} from '../../src/open/switch-container.ts';
import {pendingOf, settled} from './pending.ts';
import {CONFIG, FOLDER, portsOf, setup, type Setup} from './reopen.fixture.ts';

/** The second configuration of the folder, in a subfolder of `.devcontainer`. */
const OTHER = `${FOLDER}/.devcontainer/other/devcontainer.json`;

/** The text of the dialog S240, which the modal shows. */
const NO_OTHER =
  'No other Dev Container configurations found in folder. Did you mean to open another folder in a container?';

/** The window's own authority: a dev container window of `FOLDER` connected through `configFile`. */
function containerAuthority(configFile: string): string {
  return `dev-container+${devContainerPayloadOf({
    kind: 'folder',
    hostPath: FOLDER,
    localDocker: false,
    configFile: {$mid: 1, fsPath: configFile, path: configFile, scheme: 'file'},
  })}`;
}

/** What the command did beside the setup's own record. */
interface Seen {
  modals: Array<[string, string]>;
  opened: number;
  reopened: number;
  picks: Array<{descriptions: string[]; title: string | undefined}>;
}

/** The command in a dev container window of the folder with two configurations, connected through `CONFIG`. */
function commandOf(
  state: Setup,
  options: {
    authority?: string | undefined;
    resolve?: LastResolve;
    buttonPressed?: boolean;
  } = {},
) {
  const {ports} = portsOf(state);
  const seen: Seen = {modals: [], opened: 0, reopened: 0, picks: []};
  const authority =
    'authority' in options ? options.authority : containerAuthority(CONFIG);
  const handler = switchContainer({
    ...ports,
    config: {
      ...ports.config,
      surfaces: {
        ...ports.config.surfaces,
        pick: (rows, placeholder, openFileTooltip, title) => {
          seen.picks.push({
            descriptions: rows.map(each => each.description),
            title,
          });
          return Promise.resolve(state.pick);
        },
      },
    },
    window: {
      ...ports.window,
      remoteAuthority: () => authority,
      isTrusted: () => state.trust === 'trusted',
    },
    lastResolve: () => options.resolve ?? 'succeeded',
    askToOpenFolder: (detail, button) => {
      seen.modals.push([detail, button]);
      return Promise.resolve(options.buttonPressed ?? false);
    },
    openFolder: () => {
      seen.opened += 1;
      return Promise.resolve();
    },
    reopen: () => {
      seen.reopened += 1;
      return Promise.resolve();
    },
  });
  return {handler, seen};
}

/** A setup of a dev container window on the folder, which holds two configurations. */
function containerSetup(): Setup {
  const state = setup();
  state.remoteName = 'dev-container';
  state.folders = [{scheme: 'vscode-remote', fsPath: '/workspaces/p'}];
  state.existing = [CONFIG, OTHER];
  return state;
}

/** The configuration file the first command of the setup opened a window for. */
function reloadedConfigOf(state: Setup): string | undefined {
  const {authority} = state.commands[0]?.parameters[0] as {authority: string};
  const target = devContainerTargetOf(authority.slice('dev-container+'.length));
  return 'configFile' in target
    ? (target.configFile.fsPath ?? target.configFile.path)
    : undefined;
}

describe('Switch Container (card containers-166, F-0407)', () => {
  it('F-0407 AC-2, AC-19, AC-11: the picker has the title S299, a description per configuration with " (Current)" on the connected one, and the first item in the order of the initial picker', async () => {
    const state = containerSetup();
    state.pick = {kind: 'dismissed'};
    const {handler, seen} = commandOf(state);
    await handler();
    deepStrictEqual(seen.picks, [
      {
        descriptions: [
          '.devcontainer/devcontainer.json (Current)',
          '.devcontainer/other/devcontainer.json',
        ],
        title: 'Select Configuration',
      },
    ]);
  });

  it('F-0407 AC-3, AC-18: another configuration reloads the same window on it, after the window told the shutdown helper that it leaves its container', async () => {
    const state = containerSetup();
    state.pick = {kind: 'picked', index: 1};
    const {handler} = commandOf(state);
    await handler();
    deepStrictEqual(
      [
        state.commands.map(entry => entry.command),
        reloadedConfigOf(state),
        state.left,
        state.order.indexOf('leave') < state.order.indexOf('open'),
      ],
      [['vscode.openFolder'], OTHER, 1, true],
    );
  });

  it('F-0407 AC-4, AC-5, AC-26: the connected configuration, Escape and Open File change nothing: no reload, no leave', async () => {
    const results = [];
    for (const pick of [
      {kind: 'picked', index: 0},
      {kind: 'dismissed'},
      {kind: 'openFile', index: 1},
    ] as const) {
      const state = containerSetup();
      state.pick = pick;
      await commandOf(state).handler();
      results.push([state.commands.length, state.left]);
    }
    deepStrictEqual(results, [
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('F-0407 AC-24: in a window with no folder open every pick reconnects, the connected configuration included', async () => {
    const state = containerSetup();
    state.folders = [];
    state.pick = {kind: 'picked', index: 0};
    await commandOf(state).handler();
    deepStrictEqual(
      [state.commands.length, reloadedConfigOf(state)],
      [1, CONFIG],
    );
  });

  it('F-0407 AC-6: with the connected configuration alone the modal S240 shows, Cancel changes nothing and its primary button goes to Open Folder in Container', async () => {
    const results = [];
    for (const buttonPressed of [false, true]) {
      const state = containerSetup();
      state.existing = [CONFIG];
      const {handler, seen} = commandOf(state, {buttonPressed});
      await handler();
      results.push([
        seen.modals,
        seen.opened,
        state.commands.length,
        seen.picks.length,
      ]);
    }
    deepStrictEqual(results, [
      [[[NO_OTHER, 'Open Folder in Container...']], 0, 0, 0],
      [[[NO_OTHER, 'Open Folder in Container...']], 1, 0, 0],
    ]);
  });

  it('F-0407 AC-23: a window whose last resolve failed gets the modal S240 without discovery or an engine check, whatever the folder holds', async () => {
    const state = containerSetup();
    const {handler, seen} = commandOf(state, {resolve: 'failed'});
    await handler();
    deepStrictEqual(
      [seen.modals.length, seen.picks.length, state.calls],
      [1, 0, []],
    );
  });

  it('F-0407 AC-28, AC-29, 7.E8: in a local window with at most one configuration the modal S240 shows, and with several the Reopen in Container flow runs', async () => {
    const results = [];
    for (const existing of [[], [CONFIG], [CONFIG, OTHER]]) {
      const state = setup();
      state.existing = existing;
      const {handler, seen} = commandOf(state, {authority: undefined});
      await handler();
      results.push([seen.modals.length, seen.reopened, seen.picks.length]);
    }
    deepStrictEqual(results, [
      [1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('F-0407 AC-1: the command does nothing in a window of another kind, in a local window of several folders and in a container window without a folder payload', async () => {
    const results = [];
    for (const change of [
      (state: Setup) => {
        state.remoteName = 'ssh-remote';
      },
      (state: Setup) => {
        state.folders = [
          {scheme: 'file', fsPath: '/a'},
          {scheme: 'file', fsPath: '/b'},
        ];
      },
    ]) {
      const state = setup();
      change(state);
      const {handler, seen} = commandOf(state, {authority: undefined});
      await handler();
      results.push([seen.modals.length, seen.reopened, state.commands.length]);
    }
    const state = containerSetup();
    const {handler, seen} = commandOf(state, {authority: 'dev-container+7b7d'});
    await handler();
    results.push([
      seen.modals.length,
      seen.picks.length,
      state.commands.length,
    ]);
    deepStrictEqual(results, [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it('F-0407 AC-9: the engine check stops the command before the picker, and a second call while one runs returns at once', async () => {
    const stopped = containerSetup();
    stopped.check = 'stopped';
    const first = commandOf(stopped);
    await first.handler();
    const running = containerSetup();
    const hold = pendingOf<undefined>();
    running.waitOnCheck = hold.promise;
    running.pick = {kind: 'dismissed'};
    const second = commandOf(running);
    const pending = second.handler();
    await second.handler();
    await settled();
    const callsWhileRunning = running.calls.length;
    hold.resolve(undefined);
    await pending;
    deepStrictEqual(
      [first.seen.picks.length, callsWhileRunning, second.seen.picks.length],
      [0, 1, 1],
    );
  });

  it('F-0407: without the proposals a container window needs the command shows the setup and goes no further', async () => {
    const state = containerSetup();
    state.missing = ['resolvers'];
    state.missingAfter = ['resolvers'];
    const {handler, seen} = commandOf(state);
    await handler();
    deepStrictEqual(
      [state.calls, seen.picks.length, seen.modals.length],
      [['setupAgain'], 0, 0],
    );
  });

  it('F-0407: a window of a legacy payload has no connected configuration to mark, and one whose file has no fsPath is marked by its path', async () => {
    const legacy = containerSetup();
    legacy.pick = {kind: 'dismissed'};
    const legacyRun = commandOf(legacy, {
      authority: `dev-container+${Buffer.from(FOLDER).toString('hex')}`,
    });
    await legacyRun.handler();
    const plain = containerSetup();
    plain.pick = {kind: 'dismissed'};
    const plainRun = commandOf(plain, {
      authority: `dev-container+${devContainerPayloadOf({
        kind: 'folder',
        hostPath: FOLDER,
        localDocker: false,
        configFile: {$mid: 1, path: CONFIG, scheme: 'file'},
      })}`,
    });
    await plainRun.handler();
    deepStrictEqual(
      [legacyRun.seen.picks, plainRun.seen.picks].map(picks =>
        picks.map(each => each.descriptions),
      ),
      [
        [
          [
            '.devcontainer/devcontainer.json',
            '.devcontainer/other/devcontainer.json',
          ],
        ],
        [
          [
            '.devcontainer/devcontainer.json (Current)',
            '.devcontainer/other/devcontainer.json',
          ],
        ],
      ],
    );
  });

  it('F-0201 AC-55: the engine check gets the folder as its base only once the window is trusted, and a window with no authority does nothing', async () => {
    const calls = [];
    for (const trust of ['trusted', 'declined'] as const) {
      const state = containerSetup();
      state.check = 'stopped';
      state.trust = trust;
      await commandOf(state).handler();
      calls.push(state.calls);
    }
    const none = containerSetup();
    const {handler, seen} = commandOf(none, {authority: undefined});
    await handler();
    deepStrictEqual(
      [calls, none.calls, seen.picks.length],
      [[[`firstCheck ${FOLDER}`], ['firstCheck undefined']], [], 0],
    );
  });
});
