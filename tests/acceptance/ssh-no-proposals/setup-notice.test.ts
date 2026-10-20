import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  connectionLog,
  emptyWindows,
  inWindow,
  openWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  notificationButtons,
  notificationCentre,
  notifications,
} from '../windows/renderer.ts';

/**
 * The start of F-2001 §3.4's setup notice on genuine VS Code. The ids it names after it include the harness's window
 * agent, which declares a proposal of its own; a user's editor has only the family's.
 */
const SETUP_START =
  'Remote - SSH needs proposed VS Code APIs that Visual Studio Code has not enabled for it.';

/** The log line of the gate (F-2003 §3.4), for the three proposals Remote - SSH declares that an editor can withhold. */
const MISSING_LINE =
  'Missing proposed APIs: resolvers, tunnels, terminalDataWriteEvent';

/**
 * Waits for `found` and, when it times out, says why the notice may be missing: the gate tells a profile once, and a
 * "Not Now" in an earlier launch of the run (the VSCodium `no-proposals` launch) keeps it silent until a probe passes.
 */
async function noticeWithin(
  description: string,
  found: () => Promise<boolean>,
): Promise<void> {
  try {
    await waitFor(description, found, NOTICE_MILLISECONDS);
  } catch (caught) {
    throw new Error(
      `${caught instanceof Error ? caught.message : String(caught)}; an earlier launch of this run that dismissed the setup notice silences it for the profile: make this launch after genuine, or in a run without no-proposals`,
      {cause: caught},
    );
  }
}

/** How long a row waits for the notice, and for a window that must not open. */
const NOTICE_MILLISECONDS = 20_000;

/** The log lines written since the `mark`-th, that are the gate's or a connect command's without the grant. */
function gateLinesSince(mark: number): string[] {
  return connectionLog()
    .slice(mark)
    .filter(line => line === MISSING_LINE || line.includes('opens no window'));
}

describe('genuine VS Code without the proposed APIs (card connect-84)', function () {
  this.timeout(300_000);

  it('F-2001 AC-30 (ruling-1171-calling-window): Connect to Host opens no window, and the calling window shows the setup notice as a toast with its two buttons', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'np-calling');
    mkdirSync(folder, {recursive: true});
    const name = await openFolderWindow(folder);
    try {
      const mark = connectionLog().length;
      const before = emptyWindows();
      await inWindow(name, 'opensshremotes.openEmptyWindow', {host: 'harness'});
      await waitFor(
        `the setup notice as a toast in window ${name}`,
        async () =>
          (await notifications(name)).some(text =>
            text.startsWith(SETUP_START),
          ),
        NOTICE_MILLISECONDS,
      );
      deepStrictEqual(
        {
          opened: emptyWindows().filter(each => !before.includes(each)),
          buttons: await notificationButtons(name, SETUP_START),
          lines: gateLinesSince(mark),
        },
        {
          opened: [],
          buttons: ['Configure Runtime Arguments', 'Not Now'],
          lines: [
            MISSING_LINE,
            'opensshremotes.openEmptyWindow opens no window: the editor has not enabled the proposed API resolvers for Remote - SSH',
          ],
        },
      );
    } finally {
      await closeWindow(name);
    }
  });

  it('F-2001 AC-30 (ruling-1171-direct): a window opened on the authority logs the missing proposals and holds the setup notice with its two buttons; core adds its own offer', async () => {
    const mark = connectionLog().length;
    await openWindow('harness', 'np-direct');
    try {
      // Core's purge hides the toast after about 10 s beside its own sticky offer, so the row reads the centre.
      await noticeWithin(
        'the setup notice in the notification centre of window np-direct',
        async () =>
          (await notificationCentre('np-direct')).some(text =>
            text.startsWith(SETUP_START),
          ),
      );
      deepStrictEqual(
        {
          buttons: await notificationButtons('np-direct', SETUP_START),
          lines: gateLinesSince(mark),
        },
        {
          buttons: ['Configure Runtime Arguments', 'Not Now'],
          lines: [MISSING_LINE],
        },
      );
    } finally {
      await closeWindow('np-direct');
    }
  });
});
