import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {sshRemoteCodec} from 'lib-authority';
import {
  appendScript,
  closeWindow,
  connectionHelpers,
  hostAliases,
  inWindow,
  isOpen,
  kill,
  messagesSince,
  onHost,
  openWindow,
  recordLines,
  reloadWindow,
  settingIn,
  sshChildren,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowState,
} from './harness.ts';

/** The question of the host pick. */
const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** The authority Connect to Host gives for the typed `harness@127.0.0.1`. */
const TYPED_AUTHORITY = sshRemoteCodec.encode({
  kind: 'host',
  hostName: '127.0.0.1',
  user: 'harness',
});

/** The user settings of per-window mode: no local server, and the host's platform named so that no pick is asked. */
const PER_WINDOW = {
  'remote.SSH.useLocalServer': false,
  'remote.SSH.remotePlatform': {harness: 'linux'},
};

/** Whether window `name` is connected: it is on the remote and a file it writes reaches the host. */
async function connected(name: string): Promise<boolean> {
  try {
    const state = await windowState(name);
    await inWindow(name, 'acceptance.agent.writeFile', 'probe.txt', name);
    return (
      state.remoteName === 'ssh-remote' &&
      (await onHost('cat', `/home/harness/${name}/probe.txt`)) === name
    );
  } catch {
    return false;
  }
}

/** Waits until window `name` is connected, for up to `milliseconds`. */
function connectedWithin(name: string, milliseconds: number): Promise<void> {
  return waitFor(
    `${name} to be connected`,
    () => connected(name),
    milliseconds,
  );
}

/** Waits until no connection helper of the run runs, for up to `milliseconds`. */
function noHelperWithin(milliseconds: number): Promise<void> {
  return waitFor(
    'no connection helper to run',
    async () => (await connectionHelpers()).length === 0,
    milliseconds,
  );
}

/** Whether the process `processId` runs. */
function runs(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until none of `processIds` runs, for up to `milliseconds`. */
function goneWithin(
  processIds: readonly number[],
  milliseconds: number,
): Promise<void> {
  return waitFor(
    `${processIds.join(', ')} to end`,
    () => processIds.every(processId => !runs(processId)),
    milliseconds,
  );
}

/** Waits until a connection helper other than those in `known` runs, for up to `milliseconds`. */
function newHelperWithin(
  known: readonly number[],
  milliseconds: number,
): Promise<void> {
  return waitFor(
    'a new connection helper',
    async () =>
      (await connectionHelpers()).some(processId => !known.includes(processId)),
    milliseconds,
  );
}

/** One scripted answer of the host pick of window `window`. */
function hostAnswer(
  window: string,
  answer: 'dismiss' | {label: string} | {typed: string},
) {
  return {
    surface: 'hostPick',
    match: 'Select configured SSH host',
    answer,
    window,
  } as const;
}

describe('the local connection server on a key host (card coverage-14)', function () {
  this.timeout(300000);

  /** The helper the steps follow, and the mark of the record at a step's start. */
  let helper: number[] = [];
  let mark = 0;
  let savedSettings: string | undefined;

  before(async () => {
    savedSettings = readUserSettings();
    for (const name of ['f1', 'b', 'c']) {
      if (isOpen(name)) {
        await closeWindow(name);
      }
    }
    await noHelperWithin(60_000);
    appendScript([
      hostAnswer('k2', 'dismiss'),
      hostAnswer('k2', {label: 'harness'}),
      hostAnswer('local', {label: 'harness'}),
      hostAnswer('k1', {typed: 'harness@127.0.0.1'}),
      hostAnswer('k2', {typed: 'harness@127.0.0.1'}),
      hostAnswer('k1', {label: 'Configure SSH Hosts...'}),
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: 'dismiss',
        window: 'k1',
      },
      hostAnswer('k1', {label: 'harness'}),
      hostAnswer('k1', {label: 'harness'}),
      hostAnswer('k1', {label: 'harness'}),
    ]);
  });

  it('setup: a window on the host opens and connects, and one helper runs', async () => {
    await openWindow('harness', 'k1');
    await connectedWithin('k1', 60_000);
    helper = await connectionHelpers();
    deepStrictEqual(helper.length, 1);
  });

  it('F-2102 AC-4, AC-5: Kill with the pick dismissed shows the host pick with the run’s hosts, and leaves the helper and the windows alone', async () => {
    await openWindow('harness', 'k2');
    await connectedWithin('k2', 60_000);
    mark = recordLines().length;
    await kill('k2');
    const line = recordLines('hostPick', 'k2').at(-1);
    deepStrictEqual(
      [
        line?.question,
        line?.items,
        await connectionHelpers(),
        messagesSince(mark),
      ],
      [
        HOST_QUESTION,
        [
          ...hostAliases(),
          '$(plus) Add New SSH Host...',
          'Configure SSH Hosts...',
        ],
        helper,
        [],
      ],
    );
  });

  it('F-2102 AC-6, AC-29: Kill of the picked host ends the helper and its ssh processes, and a new helper runs', async () => {
    const children = await sshChildren(helper[0] ?? 0);
    mark = recordLines().length;
    await kill('k2');
    await goneWithin([...helper, ...children], 2000);
    await newHelperWithin(helper, 5000);
    deepStrictEqual(messagesSince(mark), []);
  });

  it('F-2102 AC-7: the windows are connected again without a login question', async () => {
    await connectedWithin('k1', 5000);
    await connectedWithin('k2', 5000);
    deepStrictEqual(
      recordLines()
        .slice(mark)
        .filter(line => ['maskedInput', 'pick'].includes(line.surface)),
      [],
    );
  });

  it('setup: with only k1 started anew, a second window shares its helper', async () => {
    await closeWindow('k1');
    await closeWindow('k2');
    await noHelperWithin(60_000);
    await openWindow('harness', 'k1');
    await connectedWithin('k1', 60_000);
    helper = await connectionHelpers();
    await openWindow('harness', 'k2');
    await connectedWithin('k2', 60_000);
    deepStrictEqual([helper.length, await connectionHelpers()], [1, helper]);
  });

  it('F-2102 AC-14: reloading the window that started the helper leaves the helper and the other window', async () => {
    await reloadWindow('k1');
    deepStrictEqual(
      [await connectionHelpers(), await connected('k2')],
      [helper, true],
    );
  });

  it('F-2102 AC-14: closing the window that started the helper leaves the helper and the other window', async () => {
    await closeWindow('k1');
    deepStrictEqual(
      [await connectionHelpers(), await connected('k2')],
      [helper, true],
    );
  });

  it('F-2102 AC-15: Close Remote Connection of the last window ends the helper', async () => {
    await inWindow('k2', 'workbench.action.remote.close');
    await noHelperWithin(5000);
    deepStrictEqual(await connectionHelpers(), []);
  });

  it('F-2102 AC-15: closing the last window ends the helper', async () => {
    await openWindow('harness', 'k3');
    await connectedWithin('k3', 60_000);
    await closeWindow('k3');
    await noHelperWithin(5000);
    deepStrictEqual(await connectionHelpers(), []);
  });

  it('F-2102 AC-16: Kill with no helper and no window on the host shows no message and changes no window', async () => {
    mark = recordLines().length;
    await kill('local');
    deepStrictEqual(
      [
        messagesSince(mark),
        await connectionHelpers(),
        (await windowState('local')).remoteName,
      ],
      [[], [], null],
    );
  });

  it('F-2102 AC-17, AC-29: Kill with a typed user@host that is the window’s own leaves the helper and the window', async () => {
    await openWindow('harness', 'k1');
    await connectedWithin('k1', 60_000);
    helper = await connectionHelpers();
    mark = recordLines().length;
    await kill('k1');
    deepStrictEqual(
      [await connectionHelpers(), await connected('k1'), messagesSince(mark)],
      [helper, true, []],
    );
  });

  it('F-2102 AC-31, AC-29: Kill with a typed user@host ends the helper of a window opened on that authority only', async () => {
    await openWindow(TYPED_AUTHORITY, 'k2');
    await connectedWithin('k2', 60_000);
    const newest = (await connectionHelpers()).filter(
      processId => !helper.includes(processId),
    );
    mark = recordLines().length;
    await kill('k2');
    await goneWithin(newest, 2000);
    await newHelperWithin(newest, 5000);
    await connectedWithin('k2', 5000);
    deepStrictEqual(
      [
        newest.length,
        helper.every(processId => runs(processId)),
        messagesSince(mark),
      ],
      [1, true, []],
    );
  });

  it('F-2102 AC-18, AC-29: Configure SSH Hosts asks for the configuration file and leaves the helper', async () => {
    const before = await connectionHelpers();
    mark = recordLines().length;
    await kill('k1');
    deepStrictEqual(
      [
        recordLines('filePick', 'k1')
          .slice(-1)
          .map(line => line.question),
        await connectionHelpers(),
        messagesSince(mark),
      ],
      [['Edit custom SSH configuration file'], before, []],
    );
  });

  it('F-2102 AC-33: a record whose helper was killed does not stop the next connect, and Kill ends the new helper', async () => {
    await closeWindow('k1');
    await closeWindow('k2');
    await noHelperWithin(60_000);
    await openWindow('harness', 'k1');
    await connectedWithin('k1', 60_000);
    const [stale] = await connectionHelpers();
    process.kill(stale ?? 0, 'SIGKILL');
    mark = recordLines().length;
    await reloadWindow('k1');
    await connectedWithin('k1', 60_000);
    const fresh = await connectionHelpers();
    const messages = messagesSince(mark);
    await kill('k1');
    await goneWithin(fresh, 2000);
    deepStrictEqual(
      [messages, fresh.length, fresh.includes(stale ?? 0)],
      [[], 1, false],
    );
  });

  it('F-2102 AC-21: with the local server off Kill runs from a keybinding, changes no file, and the windows keep working', async () => {
    await closeWindow('k1');
    await noHelperWithin(60_000);
    await userSettings(PER_WINDOW);
    await openWindow('harness', 'k1');
    await openWindow('harness', 'k2');
    await connectedWithin('k1', 60_000);
    await connectedWithin('k2', 60_000);
    const settings = readFileSync(
      `${variable('HARNESS_RUN_FOLDER')}/user-data/User/settings.json`,
      'utf8',
    );
    const config = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
    mark = recordLines().length;
    const helpersDuring = await connectionHelpers();
    await kill('k1');
    deepStrictEqual(
      [
        helpersDuring,
        await connectionHelpers(),
        await connected('k1'),
        await connected('k2'),
        messagesSince(mark),
        readFileSync(
          `${variable('HARNESS_RUN_FOLDER')}/user-data/User/settings.json`,
          'utf8',
        ) === settings,
        readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8') === config,
      ],
      [[], [], true, true, [], true, true],
    );
  });

  it('F-2102 AC-22: turning the local server off while a helper runs and then running Kill ends it and reconnects per window', async () => {
    await closeWindow('k1');
    await closeWindow('k2');
    await userSettings({
      ...PER_WINDOW,
      'remote.SSH.useLocalServer': true,
    });
    await openWindow('harness', 'k1');
    await connectedWithin('k1', 60_000);
    const started = await connectionHelpers();
    await inWindow(
      'k1',
      'acceptance.agent.updateSetting',
      'remote.SSH.useLocalServer',
      false,
    );
    await waitFor(
      'k1 to read the local server as off',
      async () =>
        (await settingIn('k1', 'remote.SSH.useLocalServer')) === false,
      10_000,
    );
    await kill('k1');
    await goneWithin(started, 2000);
    await connectedWithin('k1', 10_000);
    deepStrictEqual(await connectionHelpers(), []);
  });

  after(async () => {
    for (const name of ['k1', 'k2', 'k3']) {
      if (isOpen(name)) {
        await closeWindow(name);
      }
    }
    restoreUserSettings(savedSettings);
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
});
