import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  batchLogin,
  closeWindow,
  connected,
  connectedWithin,
  connectionHelpers,
  hostAnswer,
  hostPassword,
  isOpen,
  kill,
  masterCheck,
  masterExit,
  noHelperWithin,
  openWindow,
  recordLines,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  waitFor,
} from './harness.ts';

/** The ControlMaster aliases of the run's ssh_config. */
const MASTERS = ['master', 'master-ask', 'master-yes', 'master-autoask'];

/** The windows of this file. */
const WINDOWS = ['m1', 'm2', 'm3'];

/** The password answer of window `window`. */
function password(window: string) {
  return {
    surface: 'maskedInput',
    match: 'password',
    answer: {text: hostPassword()},
    window,
  } as const;
}

/** The `maskedInput` lines of window `window` so far. */
function questions(window: string): number {
  return recordLines('maskedInput', window).length;
}

/** Ends the connection helpers still running once the windows are closed, so that every row starts with none. */
async function endHelpers(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 3000));
  for (const helper of await connectionHelpers()) {
    process.kill(helper, 'SIGTERM');
  }
  await noHelperWithin(60_000);
}

/** Ends every master, closes the windows of this file, and leaves the local server on. */
async function clean(): Promise<void> {
  for (const alias of MASTERS) {
    await masterExit(alias);
  }
  for (const window of WINDOWS) {
    if (isOpen(window)) {
      await closeWindow(window);
    }
  }
  await endHelpers();
  await userSettings({'remote.SSH.useLocalServer': true});
}

describe('the local connection server beside an OpenSSH ControlMaster (card coverage-16)', function () {
  this.timeout(300000);

  let savedSettings: string | undefined;

  before(async () => {
    savedSettings = readUserSettings();
    await clean();
  });

  after(async () => {
    await clean();
    restoreUserSettings(savedSettings);
  });

  it('F-2102 AC-24: a window on a host that asks for a master connects, and the master serves a login with no question', async () => {
    appendScript([password('m1')]);
    await openWindow('master', 'm1');
    await connectedWithin('m1', 60_000);
    deepStrictEqual(
      [await masterCheck('master'), await batchLogin('master')],
      [true, true],
    );
  });

  it('F-2102 AC-25 (c97-master-kill): a kill of the local server leaves the master and the window, and the reload asks for no password', async () => {
    const asked = questions('m1');
    appendScript([hostAnswer('m1', {label: 'master'})]);
    await kill('m1');
    await waitFor(
      'm1 to stay connected through the kill',
      () => connected('m1'),
      60_000,
    );
    const afterKill = [await masterCheck('master'), questions('m1')];
    await reloadWindow('m1');
    await connectedWithin('m1', 60_000);
    deepStrictEqual(
      [afterKill, questions('m1'), (await connectionHelpers()).length],
      [[true, asked], asked, 1],
    );
  });

  it('F-2102 AC-26 (c97-master-perwindow): with the setting off and a live master, a reload connects without a password', async () => {
    await userSettings({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': {master: 'linux'},
    });
    const asked = questions('m1');
    await reloadWindow('m1');
    await connectedWithin('m1', 60_000);
    deepStrictEqual(
      [questions('m1'), await masterCheck('master')],
      [asked, true],
    );
  });

  it('F-2102 AC-39 (c97-master-ask): with ControlMaster ask, the shared-connection confirmation is a masked input of the same window, and yes connects it', async () => {
    await clean();
    appendScript([
      password('m1'),
      {
        surface: 'maskedInput',
        match: 'Allow shared connection',
        answer: {text: 'yes'},
        window: 'm1',
      },
    ]);
    await openWindow('master-ask', 'm1');
    await connectedWithin('m1', 60_000);
    const texts = recordLines('maskedInput', 'm1')
      .slice(-2)
      .map(line => line.question);
    deepStrictEqual(
      [
        texts.length,
        texts[1]?.includes('Allow shared connection') === true,
        await masterCheck('master-ask'),
      ],
      [2, true, true],
    );
  });

  it('F-2102 AC-40 (c97-master-yes): with ControlMaster yes, a kill and a reload ask for the password again', async () => {
    await clean();
    appendScript([
      password('m1'),
      hostAnswer('m1', {label: 'master-yes'}),
      password('m1'),
    ]);
    await openWindow('master-yes', 'm1');
    await connectedWithin('m1', 60_000);
    const masterLive = await masterCheck('master-yes');
    const asked = questions('m1');
    await kill('m1');
    await waitFor(
      'm1 to stay connected through the kill',
      () => connected('m1'),
      60_000,
    );
    await reloadWindow('m1');
    await connectedWithin('m1', 60_000);
    deepStrictEqual([masterLive, questions('m1') - asked], [true, 1]);
  });

  it('F-2102 AC-30: after the master ends, the window connects again with one new password question and a new master', async () => {
    restoreUserSettings(savedSettings);
    await clean();
    appendScript([password('m1')]);
    await openWindow('master', 'm1');
    await connectedWithin('m1', 60_000);
    const asked = questions('m1');
    appendScript([password('m1')]);
    await masterExit('master');
    await waitFor(
      'm1 to ask for the password again',
      () => Promise.resolve(questions('m1') > asked),
      30_000,
    );
    await connectedWithin('m1', 30_000);
    deepStrictEqual(
      [questions('m1') - asked, await masterCheck('master')],
      [1, true],
    );
  });

  it('F-2102 AC-40 (c129-master-autoask): with ControlMaster autoask, Kill Local Connection Server and a reload connect again with no password and no confirmation, through the same master', async () => {
    restoreUserSettings(savedSettings);
    await clean();
    appendScript([
      password('m1'),
      {
        surface: 'maskedInput',
        match: 'Allow shared connection',
        answer: {text: 'yes'},
        window: 'm1',
      },
    ]);
    await openWindow('master-autoask', 'm1');
    await connectedWithin('m1', 60_000);
    const asked = questions('m1');
    appendScript([hostAnswer('m1', {label: 'master-autoask'})]);
    await kill('m1');
    await reloadWindow('m1');
    await connectedWithin('m1', 60_000);
    deepStrictEqual(
      [questions('m1') - asked, await masterCheck('master-autoask')],
      [0, true],
    );
  });
});
