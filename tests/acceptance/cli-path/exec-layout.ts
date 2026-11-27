/**
 * @fileoverview What an exec-mode connect leaves on the host and what runs there (F-2103 AC-2, AC-26), read from the
 * data folder of the editor under test: the editor's CLI under `<applicationName>-<commit>`, the server the CLI
 * installs below `cli/servers`, the legacy install folder `bin/<commit>`, and the processes of the CLI. It is imported
 * only by the rows of this suite, so that a change to it reaches the `cli-path` launch alone.
 */

import {deepStrictEqual} from 'node:assert';
import {redact} from 'lib-log';
import {applicationNameOf} from '../../../tools/acceptance-cli-editor.ts';
import {
  closeWindow,
  connectedWithin,
  connectionLog,
  editorProduct,
  onHostAs,
  openWindow,
  recordLines,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {DATA_FOLDER, freshHost} from '../windows/maintenance.ts';
import {dialogOf, notifications} from '../windows/renderer.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';
import {failedWithReadout, stamped} from './stamped-steps.ts';

/** What the host holds and runs after a connect, as the rows compare it. */
export interface ExecFacts {
  /** Whether the editor's CLI file `<applicationName>-<commit>` is in the data folder. */
  launcher: boolean;
  /** Whether the CLI installed a server below `cli/servers` for the commit. */
  server: boolean;
  /** Whether the legacy install folder `bin/<commit>` is there. */
  binFolder: boolean;
  /** How many CLI processes serve the host: the CLI file of the commit run with `command-shell`, not its agent host child. */
  cliProcesses: number;
}

/** The names a host listing gives, none when the folder is not there. */
async function namesIn(folder: string): Promise<string[]> {
  return (
    await onHostAs(
      'harness',
      'sh',
      '-c',
      `ls -1A '${folder}' 2>/dev/null; true`,
    )
  )
    .split('\n')
    .filter(name => name !== '');
}

/** The name of the editor's CLI file for the commit: its `applicationName`, a dash and the commit. */
function launcherName(): string {
  const name = applicationNameOf(variable('HARNESS_EDITOR_EXECUTABLE'));
  if (name === undefined) {
    throw new Error("the editor's product.json names no applicationName");
  }
  return `${name}-${editorProduct().commit}`;
}

/** The command lines of the CLI processes that serve the host: the CLI file of the commit run with `command-shell`. */
export async function cliProcessLines(): Promise<string[]> {
  return (
    await onHostAs(
      'harness',
      'sh',
      '-c',
      `ps -eo pid,ppid,args | grep -F '${DATA_FOLDER}/${launcherName()} command-shell' | grep -v grep; true`,
    )
  )
    .split('\n')
    .filter(line => line !== '');
}

/** Compares `actual` with `expected` and, when they differ, adds what `told` says to the failure. */
export async function sameOrTell(
  actual: unknown,
  expected: unknown,
  told: (() => Promise<string> | string) | string,
): Promise<void> {
  try {
    deepStrictEqual(actual, expected);
  } catch (failure) {
    throw new Error(
      `${String(failure)}\n${typeof told === 'string' ? told : await told()}`,
      {cause: failure},
    );
  }
}

/** What the host holds and runs of the editor under test now. */
export async function execFacts(): Promise<ExecFacts> {
  const {commit} = editorProduct();
  return {
    launcher: (await namesIn(DATA_FOLDER)).includes(launcherName()),
    server: (await namesIn(`${DATA_FOLDER}/cli/servers`)).some(name =>
      name.endsWith(`-${commit}`),
    ),
    binFolder: (await namesIn(`${DATA_FOLDER}/bin`)).includes(commit),
    cliProcesses: (await cliProcessLines()).length,
  };
}

/** What an exec-mode connect leaves, without the legacy folder: the CLI's file, its server and one running CLI. */
export const EXEC_FACTS = {
  launcher: true,
  server: true,
  cliProcesses: 1,
} as const;

/**
 * Makes the host fresh for an exec-mode row: no server, no install, no CLI process, and no CLI file or log of an earlier connect, so
 * that the CLI file the row finds was placed by its own connect.
 */
export async function freshExecHost(): Promise<void> {
  await freshHost();
  // Ended in a command of its own: a shell whose command line also named the file it removes would match its own pattern.
  // The bracket keeps pkill's pattern from matching the shell that runs it.
  await onHostAs(
    'harness',
    'sh',
    '-c',
    `pkill -f '${DATA_FOLDER.replace('/.', '/[.]')}/(${launcherName()}|cli/)' || true`,
  );
  await onHostAs(
    'harness',
    'rm',
    '-rf',
    `${DATA_FOLDER}/${launcherName()}`,
    ...(await namesIn(DATA_FOLDER))
      .filter(name => /^\.cli\..*\.log$/u.test(name))
      .map(name => `${DATA_FOLDER}/${name}`),
  );
}

/** How long the readout of a connect that did not finish may take, in milliseconds. */
const READOUT_MILLISECONDS = 60_000;

/** How long the stalled connect's two samples of the CLI's folder are apart, in milliseconds. */
const SAMPLE_GAP_MILLISECONDS = 5000;

/** The size of the CLI's folder in kilobytes, and the newest entries below it with their sizes (the host's busybox has no find -printf). */
async function cliFolderSample(): Promise<string> {
  return onHostAs(
    'harness',
    'sh',
    '-c',
    `du -sk '${DATA_FOLDER}/cli' 2>&1; ls -lAtR '${DATA_FOLDER}/cli' 2>&1 | head -30; true`,
  );
}

/**
 * What a reader of a connect that did not finish needs to tell a stall from a slow download: the stages the window
 * showed, the CLI's folder sampled twice a few seconds apart (a download in progress grows), the tail of the CLI's own
 * logs and its processes (card #3276: a window stopped at Downloading VS Code Server and the log said no more), redacted
 * the way the log is: the CI logs are public and the CLI's own log can hold the control token.
 */
async function stalledConnectText(name: string): Promise<string> {
  const stages = recordLines(undefined, name)
    .filter(line => line.surface === 'progress')
    .map(line => line.question);
  const first = await cliFolderSample();
  await new Promise(resolve => setTimeout(resolve, SAMPLE_GAP_MILLISECONDS));
  const second = await cliFolderSample();
  const logs = await onHostAs(
    'harness',
    'sh',
    '-c',
    `for file in '${DATA_FOLDER}'/.cli.*.log; do echo "== $file"; tail -n 30 "$file"; done 2>&1; true`,
  );
  return redact(
    [
      `the stages ${name} showed: ${JSON.stringify([...new Set(stages)])}`,
      `the CLI's folder, then ${String(SAMPLE_GAP_MILLISECONDS)} ms later:\n${first}\n--\n${second}`,
      `the tail of the CLI's logs:\n${logs}`,
      `the CLI processes: ${JSON.stringify(await cliProcessLines())}`,
    ].join('\n'),
    [],
  );
}

/** What a window that connected shows of the extension's own messages: a dialog and the notifications. */
export interface Messages {
  dialog: unknown;
  notifications: string[];
}

/**
 * Connects window `name` on `alias` to the fresh host under `settings` and gives what the host holds and runs, what
 * the window shows of messages a few seconds after it connected, and closes the window. The settings are the caller's
 * to put back.
 */
export async function execConnect(
  rowName: string,
  name: string,
  settings: Readonly<Record<string, unknown>>,
): Promise<{facts: ExecFacts; messages: Messages; told: string}> {
  await stamped(rowName, 'the host is made fresh', 120_000, freshExecHost);
  await userSettings({...PLATFORMS, ...settings});
  const mark = connectionLog().length;
  await stamped(rowName, 'the window opens', 60_000, () =>
    openWindow('harness', name),
  );
  try {
    await stamped(rowName, 'the connect', 130_000, () =>
      connectedWithin(name, 120_000),
    ).catch(async (failure: unknown) => {
      throw await failedWithReadout(
        rowName,
        failure,
        () => stalledConnectText(name),
        READOUT_MILLISECONDS,
      );
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    return {
      told: `the connect's lines about the install: ${JSON.stringify(
        connectionLog()
          .slice(mark)
          .filter(line =>
            /exec|legacy|CLI|install|Server result|server-progress/i.test(line),
          ),
      )}`,
      facts: await execFacts(),
      messages: {
        dialog: await dialogOf(name),
        notifications: await notifications(name),
      },
    };
  } finally {
    await stamped(rowName, 'the window closes', 120_000, () =>
      closeWindow(name),
    ).catch((caught: unknown) => {
      console.log(`${rowName}: the window's close failed: ${String(caught)}`);
    });
  }
}

/** The process ids of the servers the CLI started for the commit: the wrapper below `cli/servers`, sorted. */
export async function execServerPids(): Promise<number[]> {
  // The bracket keeps the pattern from matching the shell that runs it.
  return (
    await onHostAs(
      'harness',
      'sh',
      '-c',
      `pgrep -u harness -f '${DATA_FOLDER}/cli/servers/[^ ]*/server/bin/[c]odium-server'; status=$?; [ $status -le 1 ] || exit $status`,
    )
  )
    .split('\n')
    .filter(line => line !== '')
    .map(Number)
    .sort((first, second) => first - second);
}
