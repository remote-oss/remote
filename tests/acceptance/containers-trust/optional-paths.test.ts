import {deepStrictEqual} from 'node:assert';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {isTrusted, waitFor} from '../windows/harness.ts';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  detailedQuickPickRows,
  dialogOf,
  notificationCentre,
  pressQuickPickOk,
  pressQuickPickTitleButton,
  quickPickChrome,
  quickPickFacts,
  quickPickOf,
  toggleQuickPickRow,
} from '../windows/renderer.ts';
import {
  BOOLEAN_SCREEN,
  FEATURES_PLACEHOLDER,
  screenWith,
  startedWith,
  STRING_SCREENS,
  takenThrough,
  withWindow,
} from '../windows/authoring-support.ts';

const OPTIONAL_PLACEHOLDER = 'Include the following optional files/directories';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** The files under `folder`, relative and sorted. */
function filesIn(folder: string): string[] {
  return readdirSync(folder, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile())
    .map(entry =>
      path.relative(folder, path.join(entry.parentPath, entry.name)),
    )
    .sort();
}

/** What a run of the stage showed and wrote. */
interface StageRun {
  trusted: boolean | undefined;
  facts: unknown;
  counter: string;
  rows: string[];
  files: string[];
  notices: string[];
  left: unknown[];
}

/**
 * Runs the wizard on the options-lab template in a fresh window, takes it to the optional files stage, reads the stage,
 * checks `alpha.txt` and presses OK, and gives what the stage showed, the files written, the notice and whether the
 * window was trusted.
 */
async function stageRun(name: string): Promise<StageRun> {
  let seen: StageRun | undefined;
  await withWindow(name, {}, async (window, folder) => {
    await startedWith(window, 'options-lab');
    await takenThrough(window, STRING_SCREENS);
    await screenWith(window, BOOLEAN_SCREEN);
    await pressQuickPickOk(window);
    await screenWith(window, FEATURES_PLACEHOLDER);
    await pressQuickPickTitleButton(window, 'Finish');
    await screenWith(window, OPTIONAL_PLACEHOLDER);
    await waitFor(
      'the rows to be drawn',
      async () => (await detailedQuickPickRows(window)).length === 3,
      15_000,
    );
    const facts = await quickPickFacts(window);
    const counter = (await quickPickChrome(window)).counter;
    const rows = (await detailedQuickPickRows(window)).map(each => each.label);
    await toggleQuickPickRow(window, 'alpha.txt');
    await pressQuickPickOk(window);
    await waitFor(
      'the reopen notification',
      async () =>
        (await notificationCentre(window)).some(text =>
          text.startsWith(NOTICE_START),
        ),
      60_000,
    );
    seen = {
      trusted: await isTrusted(window),
      facts,
      counter,
      rows,
      files: filesIn(folder),
      notices: (await notificationCentre(window)).filter(text =>
        text.startsWith(NOTICE_START),
      ),
      left: [await quickPickOf(window), await dialogOf(window)],
    };
  });
  if (seen === undefined) {
    throw new Error(`the run ${name} did not finish`);
  }
  return seen;
}

describe('the optional files stage with trust turned off and in Restricted Mode (card tooling-82)', function () {
  this.timeout(600_000);

  afterEach(async () => {
    await setUserSetting('security.workspace.trust.enabled', undefined);
  });

  it('F-0805 AC-19 (trust): with workspace trust turned off and in an untrusted folder the stage, the files written and the notification are the same', async () => {
    await setUserSetting('security.workspace.trust.enabled', false);
    const turnedOff = await stageRun('t82-trust-off');
    await setUserSetting('security.workspace.trust.enabled', undefined);
    const restricted = await stageRun('t82-restricted');
    function withoutTrust(result: StageRun): Omit<StageRun, 'trusted'> {
      const {trusted, ...rest} = result;
      return trusted ? rest : rest;
    }
    deepStrictEqual(
      [turnedOff.trusted, restricted.trusted, withoutTrust(restricted)],
      [true, false, withoutTrust(turnedOff)],
    );
  });
});
