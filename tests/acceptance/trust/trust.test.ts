import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import {
  isTrusted,
  openWindow,
  recordLines,
  trustSettled,
  windowState,
} from '../windows/harness.ts';
import {answerDialog, dialogOf, waitForDialog} from '../windows/renderer.ts';

/** The question core's startup prompt asks of a folder. */
const FOLDER_QUESTION = 'Do you trust the authors of the files in this folder?';

/** The buttons of core's startup prompt, in the order the page holds them (measured on the run's build). */
const STARTUP_BUTTONS = [
  "No, I don't trust the authors",
  'Yes, I trust the authors',
];

describe('the trust launch (card tooling-33)', function () {
  this.timeout(300000);

  it('tooling-33: a remote folder opens untrusted, and core asks its startup question', async () => {
    await openWindow('harness', 's1');
    const trusted = await isTrusted('s1');
    const shown = await waitForDialog('s1');
    deepStrictEqual(
      [trusted, shown.message, shown.buttons],
      [false, FOLDER_QUESTION, STARTUP_BUTTONS],
    );
  });

  it('tooling-33: trusting the folder closes the dialog, and the window becomes trusted', async () => {
    await answerDialog('s1', 'Yes, I trust the authors');
    deepStrictEqual(
      [await trustSettled('s1', true), await dialogOf('s1')],
      [true, undefined],
    );
  });

  it('tooling-33: refusing trust closes the dialog, and the window stays untrusted', async () => {
    await openWindow('harness', 's2');
    await waitForDialog('s2');
    await answerDialog('s2', "No, I don't trust the authors");
    deepStrictEqual(
      [await isTrusted('s2'), await dialogOf('s2')],
      [false, undefined],
    );
  });

  it('tooling-33: answerDialog with a label the open dialog has not fails, listing its labels', async () => {
    await openWindow('harness', 's4');
    await waitForDialog('s4');
    const failure = await answerDialog('s4', 'No such button').then(
      () => 'answered',
      (caught: unknown) => (caught as Error).message,
    );
    await answerDialog('s4', "No, I don't trust the authors");
    deepStrictEqual(
      [failure, await dialogOf('s4')],
      [
        `window s4: no button "No such button" among ${JSON.stringify(STARTUP_BUTTONS)}`,
        undefined,
      ],
    );
  });

  it('tooling-33: answerDialog with no dialog open fails, naming the window', async () => {
    await rejects(answerDialog('s2', 'Yes, I trust the authors'), {
      message: 'window s2: no dialog open',
    });
  });

  it('F-2501 AC-22: the resolve leaves an undecided folder untrusted, in Restricted Mode with core’s trust dialog', async () => {
    await openWindow('harness', 'r22');
    const state = await windowState('r22');
    const trusted = await isTrusted('r22');
    const shown = await waitForDialog('r22');
    deepStrictEqual(
      [state.remoteAuthority, trusted, shown.message],
      ['ssh-remote+harness', false, FOLDER_QUESTION],
    );
    await answerDialog('r22', "No, I don't trust the authors");
  });

  it('F-2001 AC-14: the window connects while core’s trust question is still open, and the extension asks nothing of its own', async () => {
    await openWindow('harness', 'r14');
    const asked = await waitForDialog('r14');
    const state = await windowState('r14');
    deepStrictEqual(
      [
        asked.message,
        state.remoteName,
        (await dialogOf('r14'))?.message,
        recordLines(undefined, 'r14')
          .filter(line => line.surface !== 'progress')
          .map(line => line.surface),
      ],
      [FOLDER_QUESTION, 'ssh-remote', FOLDER_QUESTION, []],
    );
  });

  it('F-2001 AC-28: the connected window is still untrusted', async () => {
    strictEqual(await isTrusted('r14'), false);
    await answerDialog('r14', "No, I don't trust the authors");
  });
});
