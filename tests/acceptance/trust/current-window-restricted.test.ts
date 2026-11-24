import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  emptyWindows,
  hostAnswer,
  isTrusted,
  nextEmptyWindow,
  recordLines,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {runFromPalette} from '../windows/palette.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

/** The question of the host picker of Connect Current Window to Host.... */
const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** The command the rows run, as a user would, from the palette. */
const SWITCH = 'Remote-SSH: Connect Current Window to Host...';

/** The answer of core's startup question that keeps the folder in Restricted Mode. */
const REFUSE = "No, I don't trust the authors";

/** How long the rows let a window settle, so that a connection that comes late would have come. */
const SETTLE_MILLISECONDS = 5000;

describe('Connect Current Window to Host in Restricted Mode', function () {
  this.timeout(300_000);

  let name = '';

  before(async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c3014-restricted',
    );
    mkdirSync(folder, {recursive: true});
    name = await openFolderWindow(folder);
    await waitForDialog(name, 60_000);
    await answerDialog(name, REFUSE);
    await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
    await userSettings({...PLATFORMS});
  });

  after(async () => {
    await closeWindow(name).catch(() => undefined);
  });

  it('F-2302 AC-26 (c3014-restricted-pick): in Restricted Mode the command from the palette opens the host pick of AC-4; dismissed, nothing opens and the window stays', async () => {
    const before = windowNames();
    appendScript([hostAnswer(name, 'dismiss')]);
    await runFromPalette(name, SWITCH);
    await waitFor(
      'the host pick',
      () => recordLines('hostPick', name).length > 0,
      30_000,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    const pick = recordLines('hostPick', name)[0];
    deepStrictEqual(
      [
        await isTrusted(name),
        pick?.question,
        pick?.items?.slice(-2),
        windowNames(),
        windowEvents(name).some(event => event.event === 'deactivated'),
      ],
      [
        false,
        HOST_QUESTION,
        ['$(plus) Add New SSH Host...', 'Configure SSH Hosts...'],
        before,
        false,
      ],
    );
  });

  it('F-2302 AC-26 (c3014-restricted-switch): in Restricted Mode a host picked from the palette reloads the same window onto it with no folder, and opens no window', async () => {
    let next = '';
    try {
      const leftover = emptyWindows();
      appendScript([hostAnswer(name, {label: 'harness'})]);
      next = await nextEmptyWindow(() => runFromPalette(name, SWITCH));
      await waitFor(
        `${next} to show its host`,
        async () => (await windowState(next)).remoteName === 'ssh-remote',
        120_000,
      );
      deepStrictEqual(
        [
          (await windowState(next)).remoteAuthority,
          (await windowState(next)).folders,
          windowEvents(name).at(-1)?.event,
          emptyWindows().filter(each => !leftover.includes(each)),
        ],
        ['ssh-remote+harness', [], 'deactivated', [next]],
      );
    } finally {
      await closeWindow(next).catch(() => undefined);
    }
  });
});
