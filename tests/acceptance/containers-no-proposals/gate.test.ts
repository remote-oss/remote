import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  activeEditorOf,
  commandsOf,
  inWindow,
  reloadWindow,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {
  answerNotification,
  notificationButtons,
  notificationCentre,
} from '../windows/renderer.ts';

/** The window the rows open: a `dev-container` authority whose payload is the hex of `{}`, which only activates the package. */
const WINDOW = 'gate-setup';

/** The commands Dev Containers contributes: they stay registered without the proposed API (brief ruling 9). */
const CONTRIBUTED = (
  (
    JSON.parse(
      readFileSync(
        path.join(
          import.meta.dirname,
          '..',
          '..',
          '..',
          'packages',
          'remote-containers',
          'package.json',
        ),
        'utf8',
      ),
    ) as {contributes?: {commands?: Array<{command: string}>}}
  ).contributes?.commands ?? []
)
  .map(entry => entry.command)
  .sort();

/**
 * The start of Dev Containers' setup notice, with the proposed API not enabled. Core raises the notice beside its own
 * failed-resolve error and does not always show it as a toast, so the row reads the notification centre.
 */
const SETUP_START = 'Dev Containers needs proposed VS Code APIs that ';

/** The start of the notice after a setup attempt that didn't enable the proposals. */
const FAILED_ATTEMPT_START =
  'The previous setup attempt did not enable the proposed APIs ';

/** The start of the restart offer after the runtime arguments were saved. */
const RESTART_START = 'Quit and start ';

/** The notifications of window `name` that are Dev Containers' setup notices. */
async function setupNotices(name: string): Promise<string[]> {
  return (await notificationCentre(name)).filter(
    text =>
      text.startsWith(SETUP_START) || text.startsWith(FAILED_ATTEMPT_START),
  );
}

describe('Dev Containers without its proposed API (card containers-09, gate row 10)', function () {
  this.timeout(180000);

  before(async () => {
    await inWindow(
      'local',
      'acceptance.agent.openWindow',
      `vscode-remote://dev-container+7b7d/workspaces/${WINDOW}`,
    );
    await waitFor(
      `window ${WINDOW} to activate its agent`,
      () => windowEvents(WINDOW).some(each => each.event === 'activated'),
      60_000,
    );
  });

  it('F-0101 AC-15 (first-clause): the setup notice names the extension, nothing of ours fails, and the commands stay registered', async () => {
    let shown: string[] = [];
    await waitFor(
      `the setup notice in window ${WINDOW}`,
      async () => {
        shown = await notificationCentre(WINDOW);
        return shown.some(text => text.startsWith(SETUP_START));
      },
      15_000,
    );
    const registered = await commandsOf(WINDOW, 'remote-containers.');
    deepStrictEqual(
      {
        setup: shown.filter(
          text =>
            text.startsWith(SETUP_START) &&
            text.includes('remote-oss.remote-containers'),
        ).length,
        failures: shown.filter(
          text =>
            text.startsWith('Dev Containers') &&
            (text.includes('Error') || text.includes('failed')),
        ),
        // Every contributed command stays registered; internal ones, such as the log link's, may be registered too.
        unregistered: CONTRIBUTED.filter(
          command => !registered.includes(command),
        ),
      },
      {setup: 1, failures: [], unregistered: []},
    );
  });
  it('F-0101 AC-15: the primary button opens argv.json, and saving and closing it unchanged offers the restart', async () => {
    await answerNotification(
      WINDOW,
      SETUP_START,
      'Configure Runtime Arguments',
    );
    await waitFor(
      `argv.json to be the active editor of window ${WINDOW}`,
      async () =>
        (await activeEditorOf(WINDOW))?.endsWith('argv.json') === true,
      30_000,
    );
    await inWindow(WINDOW, 'workbench.action.files.save');
    await inWindow(WINDOW, 'workbench.action.closeActiveEditor');
    const buttons = await notificationButtons(WINDOW, RESTART_START);
    console.log(
      `containers-09: the restart offer's buttons: ${JSON.stringify(buttons)}`,
    );
    deepStrictEqual(
      [buttons.length, buttons[0]?.startsWith('Quit ')],
      [1, true],
    );
    await inWindow(WINDOW, 'notifications.clearAll');
  });

  it('F-0101 AC-15: after that attempt, the next activation tells the failed attempt, and Not Now dismisses it', async () => {
    await reloadWindow(WINDOW);
    await answerNotification(WINDOW, FAILED_ATTEMPT_START, 'Not Now');
    await inWindow(WINDOW, 'notifications.clearAll');
  });

  it('F-0101 AC-15: after the dismissal, the next activation shows no warning', async () => {
    await reloadWindow(WINDOW);
    await new Promise(resolve => setTimeout(resolve, 15_000));
    deepStrictEqual(await setupNotices(WINDOW), []);
  });
});
