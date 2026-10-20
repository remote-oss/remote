import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {onHostAs, waitFor} from '../windows/harness.ts';
import {
  FISH_DATA_FOLDER,
  fishServerInstalled,
  fishServerRuns,
  linesSince,
  pickHost,
  runWith,
} from '../windows/maintenance.ts';

/** The notice of a kill that ran. */
function killed(host: string): string {
  return `Killed VS Code Server on ${host}.`;
}

/** The notices window `window` showed since `mark`, as their text and buttons. */
function noticesSince(mark: number, window: string): Array<[string, string[]]> {
  return linesSince(mark, window)
    .filter(line => line.surface === 'notice')
    .map(line => [line.question, line.buttons ?? []]);
}

/** Runs a kill on host in window `window` with `answers` scripted for it, and gives the mark it started from. */
function killWith(
  window: string,
  answers: readonly AppendedEntry[],
): Promise<number> {
  return runWith(window, 'opensshremotes.cleanRemoteServer', answers);
}

/** Runs an uninstall in window `window` with `answers` scripted for it, and gives the mark it started from. */
function uninstallWith(
  window: string,
  answers: readonly AppendedEntry[],
): Promise<number> {
  return runWith(window, 'opensshremotes.cleanDevBox', answers);
}

/** The surfaces window `window` wrote since `mark`, in order. */
function surfacesSince(mark: number, window: string): string[] {
  return linesSince(mark, window).map(line => line.surface);
}

describe('the server rows on a fish login shell (card tooling-55)', function () {
  this.timeout(600_000);

  it('F-2411 AC-24 (ruling-fish): on a host whose login shell is fish, Kill on Host says it killed the server, and the server is stopped', async () => {
    await fishServerInstalled('fish-kill');
    const runningBefore = await fishServerRuns();
    const mark = await killWith('local', [pickHost('harness-fish')]);
    await waitFor(
      'the server of harness-fish to stop',
      async () => !(await fishServerRuns()),
      10_000,
    );
    deepStrictEqual(
      {runningBefore, notices: noticesSince(mark, 'local')},
      {runningBefore: true, notices: [[killed('harness-fish'), ['Open Logs']]]},
    );
  });

  it('F-2412 AC-24 (ruling-fish): on a host whose login shell is fish, Uninstall removes the server folder with no UI, well inside the connect timeout', async () => {
    await fishServerInstalled('fish-uninstall');
    const started = Date.now();
    const mark = await uninstallWith('local', [pickHost('harness-fish')]);
    const took = Date.now() - started;
    const folderLeft = await onHostAs(
      'harness-fish',
      'test',
      '-e',
      FISH_DATA_FOLDER,
    ).then(
      () => true,
      () => false,
    );
    deepStrictEqual(
      {
        surfaces: surfacesSince(mark, 'local'),
        folderLeft,
        running: await fishServerRuns(),
        withinTimeout: took < 15_000,
      },
      {
        surfaces: ['hostPick'],
        folderLeft: false,
        running: false,
        withinTimeout: true,
      },
    );
  });
});
