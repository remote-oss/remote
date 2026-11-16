import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {cachedLabelAuthorities} from '../windows/global-state.ts';
import {
  appendScript,
  closeWindow,
  heldLines,
  inWindow,
  openWindow,
  recordLines,
  signal,
  startInWindow,
  variable,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {dismissals} from '../windows/maintenance.ts';
import {
  pressEscape,
  quickPickOf,
  statusItem,
  statusItemText,
  windowTitle,
} from '../windows/renderer.ts';

/**
 * The password-only account spelt with its user: an authority of its own, as core counts authorities, that no connect that works uses,
 * so the editor holds no label of it when its first resolve runs.
 */
const NEVER_CONNECTED = 'harness-pwonly@password-retry';

/** The window of the connect whose password is refused. */
const WINDOW = 'c2635-first';

describe('the window label of an authority whose first resolve fails (card #2635)', function () {
  this.timeout(600_000);

  it('F-2502 AC-17 (c2635-first-fail): while the first resolve runs the title has no suffix and the indicator reads Opening Remote..., after the refusal the title reads [SSH] and the indicator Disconnected from SSH, and core caches no label of the authority', async () => {
    appendScript([
      {
        surface: 'maskedInput',
        match: 'Enter password',
        answer: 'dismiss',
        window: WINDOW,
        after: 'c2635-refuse',
      },
      ...dismissals(WINDOW),
    ]);
    await openWindow(NEVER_CONNECTED, WINDOW);
    await waitFor(
      'the password input to wait',
      () => heldLines(WINDOW).length > 0,
      120_000,
    );
    const opening = {
      title: await windowTitle(WINDOW),
      indicator: (await statusItem(WINDOW, 'status.host')).text,
    };
    signal('c2635-refuse');
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', WINDOW).length > 0,
      60_000,
    );
    const failed = {
      indicator: await statusItemText(
        WINDOW,
        'status.host',
        'Disconnected from SSH',
        30_000,
      ),
      title: await windowTitle(WINDOW),
    };
    deepStrictEqual(
      [
        opening,
        failed,
        cachedLabelAuthorities().includes(`ssh-remote+${NEVER_CONNECTED}`),
      ],
      [
        {title: `[${WINDOW}]`, indicator: 'Opening Remote...'},
        {indicator: 'Disconnected from SSH', title: `[${WINDOW} [SSH]]`},
        false,
      ],
    );
  });

  it('F-2502 AC-34 (c2635-recent): a local window opened after the refusal lists the authority’s folder in Open Recent as <folder> [SSH]', async () => {
    // A local folder of its own names the later window and its title apart from every empty window of the run.
    const later = 'c2635-later';
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), later);
    mkdirSync(folder, {recursive: true});
    await inWindow(
      'local',
      'acceptance.agent.openWindow',
      pathToFileURL(folder).href,
    );
    await waitFor(
      `window ${later} to open`,
      () => windowNames().includes(later),
      60_000,
    );
    try {
      await startInWindow(later, 'workbench.action.openRecent');
      let rows: string[] = [];
      await waitFor(
        'the recent entry of the refused authority',
        async () => {
          rows = ((await quickPickOf(later))?.items ?? []).filter(label =>
            label.startsWith(WINDOW),
          );
          return rows.length > 0;
        },
        30_000,
      );
      await pressEscape(later);
      deepStrictEqual(rows, [`${WINDOW} [SSH]`]);
    } finally {
      await closeWindow(later).catch(() => undefined);
      await closeWindow(WINDOW).catch(() => undefined);
    }
  });
});
