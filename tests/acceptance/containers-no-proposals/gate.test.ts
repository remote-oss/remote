import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  commandsOf,
  inWindow,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {notificationCentre} from '../windows/renderer.ts';

/** The window the rows open: a `dev-container` authority whose payload is the hex of `{}`, which only activates the package. */
const WINDOW = 'gate-setup';

/** The package's own file `name`, parsed. */
function packageFile(name: string): unknown {
  return JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'remote-containers',
        name,
      ),
      'utf8',
    ),
  );
}

/**
 * The commands Dev Containers registers: the ones it contributes, which stay registered without the proposed API
 * (brief ruling 9), and the runtime commands it registers without contributing.
 */
const REGISTERED = [
  ...(
    (
      packageFile('package.json') as {
        contributes?: {commands?: Array<{command: string}>};
      }
    ).contributes?.commands ?? []
  ).map(entry => entry.command),
  ...(
    packageFile('identifiers.json') as {runtimeCommands: Array<{id: string}>}
  ).runtimeCommands.map(entry => entry.id),
].sort();

/**
 * The start of Dev Containers' setup notice, with the proposed API not enabled. Core raises the notice beside its own
 * failed-resolve error and does not always show it as a toast, so the row reads the notification centre.
 */
const SETUP_START = 'Dev Containers needs proposed VS Code APIs that ';

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
        commands: await commandsOf(WINDOW, 'remote-containers.'),
      },
      {setup: 1, failures: [], commands: REGISTERED},
    );
  });
});
