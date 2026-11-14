/**
 * @fileoverview The failures of a login through the user's own askpass program (F-2309): a program that cancels, that
 * answers wrongly, that answers late or not at all. The window shows the failure dialog of F-2601 and no VS Code input.
 */

import {deepStrictEqual} from 'node:assert';
import {renameSync} from 'node:fs';
import path from 'node:path';
import {
  openWindow,
  readUserSettings,
  restoreUserSettings,
  variable,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
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
  deniedDetails,
  forgetHostKey,
  knowHostKey,
  passwordRule,
  useOwnConfig,
  withSettings,
  writeStandIns,
} from '../windows/askpass-support.ts';

/** The setting of the feature. */
const EXTERNAL = 'remote.SSH.externalSSH_ASKPASS';

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

  it('F-2309 AC-12 (c2596-program-cancels): with a known host key and a program that exits non-zero, the failure dialog names the permission denial and no VS Code input shows', async () => {
    knowHostKey('askpass-pw');
    await withSettings({[EXTERNAL]: true, ...useOwnConfig()});
    answering([{match: 'password', answer: '', status: 1}]);
    await openWindow('askpass-pw', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    deepStrictEqual(
      {
        dialog,
        inputs: await inputsShown('as1'),
        called: askpassCalls().length > 0,
      },
      {
        dialog: {
          message: '',
          details: deniedDetails('askpass-pw'),
          buttons: BUTTONS,
        },
        inputs: [],
        called: true,
      },
      JSON.stringify({
        title: await windowTitle('as1'),
        indicator: await statusBarText('as1', 'status.host'),
      }),
    );
  });

  it('F-2309 AC-15 (c2596-missing-program): with SSH_ASKPASS naming a file that is not there, the failure dialog has the permission denial, no word about SSH_ASKPASS and no VS Code input', async () => {
    knowHostKey('askpass-pw');
    await withSettings({[EXTERNAL]: true, ...useOwnConfig()});
    answering([passwordRule()]);
    const program = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'askpass-bin',
      'answer',
    );
    renameSync(program, `${program}.away`);
    try {
      await openWindow('askpass-pw', 'as1');
      const dialog = await waitForDialog('as1', 120_000);
      deepStrictEqual(
        {
          dialog,
          inputs: await inputsShown('as1'),
          called: askpassCalls().length,
        },
        {
          dialog: {
            message: '',
            details: deniedDetails('askpass-pw'),
            buttons: BUTTONS,
          },
          inputs: [],
          called: 0,
        },
      );
    } finally {
      renameSync(`${program}.away`, program);
    }
  });

  it('F-2309 AC-26 (c2596-host-key-cancelled): with an unknown host key and a program that cancels the question, the failure dialog has no reason and no VS Code input shows', async () => {
    forgetHostKey('askpass-ask');
    await withSettings({[EXTERNAL]: true, ...useOwnConfig()});
    answering([{match: 'continue connecting', answer: '', status: 1}]);
    await openWindow('askpass-ask', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    deepStrictEqual(
      {dialog, inputs: await inputsShown('as1')},
      {
        dialog: {
          message: '',
          details: 'Could not establish connection to "askpass-ask".',
          buttons: BUTTONS,
        },
        inputs: [],
      },
    );
  });

  it('F-2309 AC-14 (c2596-wrong-answer): a program that answers wrongly gives the failure dialog after ssh gives up, with no fallback input, and a Retry with a corrected program connects', async () => {
    knowHostKey('askpass-pw');
    await withSettings({[EXTERNAL]: true, ...useOwnConfig()});
    answering([{match: 'password', answer: 'not-the-password'}]);
    await openWindow('askpass-pw', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    const inputs = await inputsShown('as1');
    answering([passwordRule()]);
    await answerDialog('as1', 'Retry');
    const {connectedWithin} = await import('../windows/harness.ts');
    await connectedWithin('as1', 120_000);
    deepStrictEqual(
      {dialog, inputs},
      {
        dialog: {
          message: '',
          details: deniedDetails('askpass-pw'),
          buttons: BUTTONS,
        },
        inputs: [],
      },
    );
  });

  it('F-2309 AC-20 (c2596-no-answer): a program that does not answer within the connect timeout gives the timed-out dialog and no VS Code input', async () => {
    knowHostKey('askpass-pw');
    await withSettings({[EXTERNAL]: true, ...useOwnConfig()});
    answering([
      {match: 'password', answer: hostPasswordOf(), delayMilliseconds: 90_000},
    ]);
    const began = Date.now();
    await openWindow('askpass-pw', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    const seconds = (Date.now() - began) / 1000;
    deepStrictEqual(
      {
        dialog,
        inputs: await inputsShown('as1'),
        within: seconds >= 15 && seconds <= 30,
      },
      {
        dialog: {
          message: '',
          details:
            'Could not establish connection to "askpass-pw": Connecting with SSH timed out.',
          buttons: BUTTONS,
        },
        inputs: [],
        within: true,
      },
      `the dialog came ${String(seconds)} s after the window opened`,
    );
  });

  it('F-2309 AC-20 (c2596-no-answer-part): with remote.SSH.connectTimeout 30 the timed-out dialog comes after about that time, so the setting and not the alias’s own ConnectTimeout is the wait', async () => {
    knowHostKey('askpass-pw');
    await withSettings({
      [EXTERNAL]: true,
      'remote.SSH.connectTimeout': 30,
      ...useOwnConfig(),
    });
    answering([
      {match: 'password', answer: hostPasswordOf(), delayMilliseconds: 120_000},
    ]);
    const began = Date.now();
    await openWindow('askpass-pw', 'as1');
    const dialog = await waitForDialog('as1', 150_000);
    const seconds = (Date.now() - began) / 1000;
    deepStrictEqual(
      [dialog.details, seconds >= 30 && seconds <= 45],
      [
        'Could not establish connection to "askpass-pw": Connecting with SSH timed out.',
        true,
      ],
      `the dialog came ${String(seconds)} s after the window opened`,
    );
  });

  it('F-2309 AC-21 (c2596-slow-answer): a program that takes 25 s with remote.SSH.connectTimeout 60 connects with its answer and no VS Code input', async () => {
    knowHostKey('askpass-pw');
    await withSettings({
      [EXTERNAL]: true,
      'remote.SSH.connectTimeout': 60,
      ...useOwnConfig(),
    });
    answering([
      {match: 'password', answer: hostPasswordOf(), delayMilliseconds: 25_000},
    ]);
    const {watchedConnect} = await import('../windows/askpass-support.ts');
    const watched = await watchedConnect('askpass-pw', 'as1', 150_000);
    deepStrictEqual(
      {connected: watched.connected, inputs: watched.inputs},
      {connected: true, inputs: []},
      `${JSON.stringify(await dialogOf('as1'))}; ${JSON.stringify(askpassCalls())}`,
    );
  });
});

/** The password of the host's account, which a rule answers with. */
function hostPasswordOf(): string {
  return passwordRule().answer;
}
