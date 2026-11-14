/**
 * @fileoverview The failures of a login through the user's own askpass program (F-2309): a program that cancels, that
 * answers wrongly, that answers late or not at all. The window shows the failure dialog of F-2601 and no VS Code input.
 */

import {deepStrictEqual} from 'node:assert';
import {
  openWindow,
  readUserSettings,
  restoreUserSettings,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  answerDialog,
  inputBoxOf,
  quickPickOf,
  statusBarText,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  answering,
  askpassCalls,
  clearRecords,
  forgetHostKey,
  knowHostKey,
  passwordRule,
  withSettings,
  writeStandIns,
} from './support.ts';

/** The setting of the feature. */
const EXTERNAL = 'remote.SSH.externalSSH_ASKPASS';

/** The platform of the password host, so that the platform question of F-2206 is not asked first. */
const PLATFORMS = {
  'remote.SSH.remotePlatform': {password: 'linux', 'password-ask': 'linux'},
};

/** The buttons of the failure dialog of F-2601. */
const BUTTONS = ['Retry', 'More Actions...', 'Close Remote'];

/** What a window shows of VS Code inputs at the moment. */
async function inputsShown(window: string): Promise<string[]> {
  const input = await inputBoxOf(window);
  const pick = await quickPickOf(window);
  return [input?.placeholder, pick?.placeholder].filter(
    (label): label is string => label !== undefined && label !== '',
  );
}

describe('the failures of a login through the user’s own askpass program (card #2596, F-2309)', function () {
  this.timeout(300_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
    writeStandIns();
  });

  beforeEach(() => {
    clearRecords();
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2309 AC-12, AC-27 (c2596-program-cancels): with a known host key and a program that exits non-zero, the failure dialog names the permission denial and no VS Code input shows, and the window is left disconnected', async () => {
    knowHostKey('password');
    await withSettings({[EXTERNAL]: true, ...PLATFORMS});
    answering([{match: 'password', answer: '', status: 1}]);
    await openWindow('password', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    deepStrictEqual(
      {
        message: dialog.message,
        buttons: dialog.buttons,
        inputs: await inputsShown('as1'),
        called: askpassCalls().length > 0,
        indicator: await statusBarText('as1', 'status.host'),
        title: await windowTitle('as1'),
      },
      {
        message:
          'Could not establish connection to "password": Permission denied (password).',
        buttons: BUTTONS,
        inputs: [],
        called: true,
        indicator: 'Disconnected from SSH',
        title: '[as1] [SSH]',
      },
    );
  });

  it('F-2309 AC-26 (c2596-host-key-cancelled): with an unknown host key and a program that cancels the question, the failure dialog has no reason and no VS Code input shows', async () => {
    forgetHostKey('password-ask');
    await withSettings({[EXTERNAL]: true, ...PLATFORMS});
    answering([{match: 'continue connecting', answer: '', status: 1}]);
    await openWindow('password-ask', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    deepStrictEqual(
      {
        message: dialog.message,
        buttons: dialog.buttons,
        inputs: await inputsShown('as1'),
      },
      {
        message: 'Could not establish connection to "password-ask".',
        buttons: BUTTONS,
        inputs: [],
      },
    );
  });

  it('F-2309 AC-14 (c2596-wrong-answer): a program that answers wrongly gives the failure dialog after ssh gives up, with no fallback input, and a Retry with a corrected program connects', async () => {
    knowHostKey('password');
    await withSettings({[EXTERNAL]: true, ...PLATFORMS});
    answering([{match: 'password', answer: 'not-the-password'}]);
    await openWindow('password', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    const inputs = await inputsShown('as1');
    answering([passwordRule()]);
    await answerDialog('as1', 'Retry');
    const {connectedWithin} = await import('../windows/harness.ts');
    await connectedWithin('as1', 120_000);
    deepStrictEqual(
      {message: dialog.message, inputs},
      {
        message:
          'Could not establish connection to "password": Permission denied (password).',
        inputs: [],
      },
    );
  });

  it('F-2309 AC-20 (c2596-no-answer): a program that does not answer within the connect timeout gives the timed-out dialog and no VS Code input', async () => {
    knowHostKey('password');
    await withSettings({[EXTERNAL]: true, ...PLATFORMS});
    answering([
      {match: 'password', answer: hostPasswordOf(), delayMilliseconds: 90_000},
    ]);
    const began = Date.now();
    await openWindow('password', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    const seconds = (Date.now() - began) / 1000;
    deepStrictEqual(
      {
        message: dialog.message,
        buttons: dialog.buttons,
        inputs: await inputsShown('as1'),
        within: seconds >= 15 && seconds <= 60,
      },
      {
        message:
          'Could not establish connection to "password": Connecting with SSH timed out.',
        buttons: BUTTONS,
        inputs: [],
        within: true,
      },
      `the dialog came ${String(seconds)} s after the window opened`,
    );
  });

  it('F-2309 AC-21 (c2596-slow-answer): a program that takes 25 s with remote.SSH.connectTimeout 60 connects with its answer and no VS Code input', async () => {
    knowHostKey('password');
    await withSettings({
      [EXTERNAL]: true,
      'remote.SSH.connectTimeout': 60,
      ...PLATFORMS,
    });
    answering([
      {match: 'password', answer: hostPasswordOf(), delayMilliseconds: 25_000},
    ]);
    const {watchedConnect} = await import('./support.ts');
    const watched = await watchedConnect('password', 'as1', 150_000);
    deepStrictEqual(
      {connected: watched.connected, inputs: watched.inputs},
      {connected: true, inputs: []},
    );
  });
});

/** The password of the host's account, which a rule answers with. */
function hostPasswordOf(): string {
  return passwordRule().answer;
}
