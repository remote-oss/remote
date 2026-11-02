import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionHelpers,
  hostPassword,
  isOpen,
  noHelperWithin,
  onHostAs,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreUserSettings,
} from './harness.ts';

/** The two windows of the shared login of a password host. */
const WINDOWS = ['s1', 's2'] as const;

/** The password host's user and its server data folder on the host. */
const HOST_USER = 'harness-pw';
const HOST_DATA = `/home/${HOST_USER}/.vscodium-server-insiders`;

/** The answer that types the host's password into the masked input of window `window`. */
function answer(window: string) {
  return {
    surface: 'maskedInput',
    match: 'Enter password',
    answer: {text: hostPassword()},
    window,
  } as const;
}

/** The `maskedInput` questions of window `window` so far, waiting or answered. */
function questions(window: string): number {
  return recordLines('maskedInput', window).length;
}

/** Closes the file's windows and waits until no connection helper runs. */
async function clean(): Promise<void> {
  for (const window of WINDOWS) {
    if (isOpen(window)) {
      await closeWindow(window);
    }
  }
  await noHelperWithin(60_000);
}

/** Ends the host's server, so that the next connect starts it anew. */
async function coldHost(): Promise<void> {
  await clean();
  const pattern = `pkill -u ${HOST_USER} -f '${HOST_DATA.replace('/.', '/[.]')}/'`;
  await onHostAs('root', 'sh', '-c', `${pattern} || true`);
  await noHelperWithin(60_000);
}

describe('the shared login of the local connection server (card coverage-97)', function () {
  this.timeout(600_000);

  /** The user settings before the rows, restored after them. */
  let savedSettings: string | undefined;

  before(async () => {
    savedSettings = readUserSettings();
    await coldHost();
  });

  after(async () => {
    await clean();
    restoreUserSettings(savedSettings);
  });

  it('setup: a window on the password host connects with one password question', async () => {
    appendScript([answer('s1')]);
    await openWindow('password', 's1');
    await connectedWithin('s1', 60_000);
    deepStrictEqual(
      [questions('s1'), (await connectionHelpers()).length],
      [1, 1],
    );
  });

  it('F-2102 AC-12 (c97-reload-no-prompt): a reload of a connected window reconnects without any prompt', async () => {
    const asked = questions('s1');
    const helper = await connectionHelpers();
    await reloadWindow('s1');
    await connectedWithin('s1', 60_000);
    deepStrictEqual(
      [questions('s1'), await connectionHelpers()],
      [asked, helper],
    );
  });

  it('F-2102 AC-13 (c97-new-window-no-prompt): a new window to the same host connects without any prompt, on the same helper', async () => {
    const helper = await connectionHelpers();
    await openWindow('password', 's2');
    await connectedWithin('s2', 60_000);
    deepStrictEqual([questions('s2'), await connectionHelpers()], [0, helper]);
  });
});
