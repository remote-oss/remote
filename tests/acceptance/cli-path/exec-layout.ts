/**
 * @fileoverview What an exec-mode connect leaves on the host and what runs there (F-2103 AC-2, AC-26), read from the
 * data folder of the editor under test: the editor's CLI under `<applicationName>-<commit>`, the server the CLI
 * installs below `cli/servers`, the legacy install folder `bin/<commit>`, and the processes of the CLI. It is imported
 * only by the rows of this suite, so that a change to it reaches the `cli-path` launch alone.
 */

import {applicationNameOf} from '../../../tools/acceptance-cli-editor.ts';
import {
  closeWindow,
  connectedWithin,
  editorProduct,
  onHostAs,
  openWindow,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {freshHost} from '../windows/maintenance.ts';
import {dialogOf, notifications} from '../windows/renderer.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';
import {stamped} from './stamped-steps.ts';

/** The data folder of the editor under test on the host. */
function dataFolder(): string {
  return `/home/harness/${editorProduct().serverDataFolderName}`;
}

/** What the host holds and runs after a connect, as the rows compare it. */
export interface ExecFacts {
  /** Whether the editor's CLI file `<applicationName>-<commit>` is in the data folder. */
  launcher: boolean;
  /** Whether the CLI installed a server below `cli/servers` for the commit. */
  server: boolean;
  /** Whether the legacy install folder `bin/<commit>` is there. */
  binFolder: boolean;
  /** How many processes run the CLI file of the commit. */
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

/** What the host holds and runs of the editor under test now. */
export async function execFacts(): Promise<ExecFacts> {
  const {commit} = editorProduct();
  const processes = await onHostAs(
    'harness',
    'sh',
    '-c',
    `ps -eo args | grep -F '${dataFolder()}/${launcherName()}' | grep -v grep; true`,
  );
  return {
    launcher: (await namesIn(dataFolder())).includes(launcherName()),
    server: (await namesIn(`${dataFolder()}/cli/servers`)).some(name =>
      name.endsWith(`-${commit}`),
    ),
    binFolder: (await namesIn(`${dataFolder()}/bin`)).includes(commit),
    cliProcesses: processes.split('\n').filter(line => line !== '').length,
  };
}

/** What an exec-mode connect leaves, without the legacy folder: the CLI's file, its server and one running CLI. */
export const EXEC_FACTS = {
  launcher: true,
  server: true,
  cliProcesses: 1,
} as const;

/**
 * Makes the host fresh for an exec-mode row: no server, no install, and no CLI file or log of an earlier connect, so
 * that the CLI file the row finds was placed by its own connect.
 */
export async function freshExecHost(): Promise<void> {
  await freshHost();
  await onHostAs(
    'harness',
    'sh',
    '-c',
    `rm -rf '${dataFolder()}/${launcherName()}' '${dataFolder()}'/.cli.*.log`,
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
): Promise<{facts: ExecFacts; messages: Messages}> {
  await stamped(rowName, 'the host is made fresh', 120_000, freshExecHost);
  await userSettings({...PLATFORMS, ...settings});
  await stamped(rowName, 'the window opens', 60_000, () =>
    openWindow('harness', name),
  );
  try {
    await stamped(rowName, 'the connect', 130_000, () =>
      connectedWithin(name, 120_000),
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    return {
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
