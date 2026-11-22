/**
 * @fileoverview The commit-keyed launcher on the exec-server path (F-2008 AC-15): the launcher the install put in the
 * server folder is deleted and the server killed, and the next connection installs it again and succeeds.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeContained,
  closeWindow,
  connectedWithin,
  onHostAs,
  openWindow,
  windowEvents,
} from '../windows/harness.ts';
import {runFromPalette} from '../windows/palette.ts';
import {stamped} from '../windows/stamped-steps.ts';
import {section, settledSection} from '../windows/connect-failure.ts';
import {
  dialogOf,
  notifications,
  pressEscape,
  quickPickOf,
  statusBarText,
} from '../windows/renderer.ts';

/** The server folder of the editor under test on the host. */
const SERVER_FOLDER = '/home/harness/.vscodium-server-insiders';

/** The top-level names of the server folder. */
async function namesInServerFolder(): Promise<string[]> {
  return (await onHostAs('harness', 'ls', '-1A', SERVER_FOLDER))
    .split('\n')
    .filter(name => name !== '');
}

/** The launcher among `names`: the top-level file whose name ends in a dash and a commit of 40 hex digits. */
function launcherAmong(names: readonly string[]): string {
  const found = names.find(name => /-[0-9a-f]{40}$/.test(name));
  if (found === undefined) {
    throw new Error(
      `no launcher among the names of ${SERVER_FOLDER}: ${JSON.stringify(names)}`,
    );
  }
  return found;
}

/** How long a read of what the window shows may take when the row reports where it stopped. */
const FACTS_MILLISECONDS = 10_000;

/**
 * What window `name` shows when a step has not finished: its agent's last events, the quick pick, the dialog, the notifications and the remote
 * indicator, each read within a bound and told as it came, so that a row that stops says what it was waiting on.
 */
async function windowFacts(name: string): Promise<string> {
  function bounded<Value>(read: () => Promise<Value>): () => Promise<string> {
    return async () =>
      JSON.stringify(
        await Promise.race([
          read(),
          new Promise<string>(resolve => {
            setTimeout(() => {
              resolve(`(no answer in ${String(FACTS_MILLISECONDS / 1000)} s)`);
            }, FACTS_MILLISECONDS);
          }),
        ]),
      );
  }
  return [
    // The agent's own record needs no read of the page, which every read below may wait on if the window does not answer.
    section('the last events of the window’s agent', () =>
      windowEvents(name)
        .slice(-8)
        .map(
          each =>
            `${each.event}${each.id === undefined ? '' : ` ${each.id.slice(0, 8)}`} ${String(Math.round((Date.now() - each.time) / 1000))} s ago`,
        )
        .join(', '),
    ),
    await settledSection(
      'the quick pick',
      bounded(async () => (await quickPickOf(name))?.items.slice(0, 8)),
    ),
    await settledSection(
      'the dialog',
      bounded(() => dialogOf(name)),
    ),
    await settledSection(
      'the notifications',
      bounded(() => notifications(name)),
    ),
    await settledSection(
      'the remote indicator',
      bounded(() => statusBarText(name, 'status.host')),
    ),
  ].join('; ');
}

/** The row's name in the lines it prints. */
const ROW_NAME = 'c2500-launcher';

describe('the launcher of the exec-server path (card #2500, F-2008)', function () {
  // The row's steps are bounded and say how long each took, so a hang stops at its step with its name before this cut
  // (card #3003: the row's first run on CI stopped at the runner's 300 s with no line to say where).
  this.timeout(600_000);

  it('F-2008 AC-15 (c2500-launcher): after the launcher is deleted and the server killed, the next connection installs the same launcher again and shows no error dialog', async () => {
    await stamped(ROW_NAME, 'the first window opens', 60_000, () =>
      openWindow('harness', 'f2008-launcher'),
    );
    let launcher: string;
    try {
      await stamped(ROW_NAME, 'the first connect', 130_000, () =>
        connectedWithin('f2008-launcher', 120_000),
      );
      launcher = await stamped(
        ROW_NAME,
        'the server folder is listed',
        60_000,
        async () => launcherAmong(await namesInServerFolder()),
      );
      await stamped(ROW_NAME, 'the launcher is deleted', 60_000, () =>
        onHostAs('harness', 'rm', '-f', `${SERVER_FOLDER}/${launcher}`),
      );
      await stamped(ROW_NAME, 'Kill Current VS Code Server', 90_000, () =>
        runFromPalette(
          'f2008-launcher',
          'Remote-SSH: Kill Current VS Code Server',
        ),
      ).catch(async (caught: unknown) => {
        throw new Error(
          `${String(caught)}; the window then showed: ${await windowFacts('f2008-launcher')}`,
          {cause: caught},
        );
      });
    } finally {
      await stamped(ROW_NAME, 'the first window closes', 200_000, () =>
        closeContained('f2008-launcher', pressEscape),
      );
    }
    await stamped(ROW_NAME, 'the second window opens', 60_000, () =>
      openWindow('harness', 'f2008-launcher-again'),
    );
    try {
      await stamped(ROW_NAME, 'the second connect', 130_000, () =>
        connectedWithin('f2008-launcher-again', 120_000),
      );
      deepStrictEqual(
        {
          back: (await namesInServerFolder()).includes(launcher),
          dialog: await dialogOf('f2008-launcher-again'),
        },
        {back: true, dialog: undefined},
      );
    } finally {
      await closeWindow('f2008-launcher-again');
    }
  });
});
