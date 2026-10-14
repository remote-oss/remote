import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  batchLogin,
  closeWindow,
  connectedWithin,
  connectionHelpers,
  hostPassword,
  isOpen,
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

  it('F-2102 AC-25: a reload keeps the master and asks for no password', async () => {
    const asked = questions('m1');
    await reloadWindow('m1');
    await connectedWithin('m1', 60_000);
    deepStrictEqual(questions('m1'), asked);
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
});
