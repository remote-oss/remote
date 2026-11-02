/**
 * @fileoverview What the rows of X11 forwarding run in a window on the host: a terminal, a process task and a node
 * launch configuration, each writing what it saw of the display to a file on the host, which the row then reads.
 */

import {
  closeWindow,
  connectedWithin,
  inWindow,
  onHostAs,
  openWindow,
  runProcessTask,
  userSettings,
  waitFor,
} from './harness.ts';
import {freshHost} from './maintenance.ts';
import {PLATFORMS} from './tunnel-support.ts';

/** What the program prints for a display: the variable, then the client's connection to it, then the extension count. */
export const DISPLAY_PROBE =
  'echo "DISPLAY=$DISPLAY"; xdpyinfo -display "$DISPLAY" | sed -n 1p; xdpyinfo -display "$DISPLAY" -ext all 2>/dev/null | grep -ci "^ *SECURITY"';

/** The folder of window `name` on the host. */
function folderOn(name: string): string {
  return `/home/harness/${name}`;
}

/** Opens window `name` on `alias` with `settings` on a fresh host and waits until it is connected. */
export async function x11Window(
  name: string,
  alias: string,
  settings: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await userSettings({...PLATFORMS, ...settings});
  await freshHost();
  await openWindow(alias, name);
  await connectedWithin(name, 90_000);
}

/** Closes window `name`. */
export async function x11Close(name: string): Promise<void> {
  await closeWindow(name).catch(() => undefined);
}

/** What `file` of the host holds once `file`.done exists. */
async function writtenAt(file: string): Promise<string> {
  await waitFor(
    `${file} to be written`,
    async () =>
      (
        await onHostAs(
          'harness',
          'sh',
          '-c',
          `test -e ${file}.done && echo yes`,
        ).catch(() => '')
      ).includes('yes'),
    90_000,
  );
  return onHostAs('harness', 'cat', file);
}

/** Runs `command` in a new terminal of window `name` and gives what it printed. */
export async function inTerminal(
  name: string,
  command: string,
): Promise<string> {
  const file = `${folderOn(name)}/terminal-${String(Date.now())}.txt`;
  await inWindow(name, 'workbench.action.terminal.new');
  await new Promise(resolve => setTimeout(resolve, 3000));
  await inWindow(name, 'workbench.action.terminal.sendSequence', {
    text: `{ ${command}; } > ${file} 2>&1; touch ${file}.done\n`,
  });
  return writtenAt(file);
}

/** Runs `command` as a process task of window `name` and gives what it printed. */
export async function inTask(name: string, command: string): Promise<string> {
  const file = `${folderOn(name)}/task-${String(Date.now())}.txt`;
  await runProcessTask(name, '/bin/sh', [
    '-c',
    `{ ${command}; } > ${file} 2>&1; touch ${file}.done`,
  ]);
  return writtenAt(file);
}

/** Runs a node launch configuration of window `name` that runs `command` through a shell and gives what it printed. */
export async function inDebugger(
  name: string,
  command: string,
): Promise<string> {
  const root = folderOn(name);
  const file = `${root}/debug-${String(Date.now())}.txt`;
  const program = `require('child_process').execSync(${JSON.stringify(
    `{ ${command}; } > ${file} 2>&1; touch ${file}.done`,
  )}, {shell: '/bin/sh'});`;
  const launch = JSON.stringify({
    version: '0.2.0',
    configurations: [
      {
        type: 'node',
        request: 'launch',
        name: 'X11',
        program: '${workspaceFolder}/app.js',
      },
    ],
  });
  await onHostAs(
    'harness',
    'sh',
    '-c',
    `mkdir -p '${root}/.vscode' && cat > '${root}/app.js' <<'EOF'\n${program}\nEOF\ncat > '${root}/.vscode/launch.json' <<'EOF'\n${launch}\nEOF`,
  );
  await inWindow(name, 'workbench.action.debug.start');
  return writtenAt(file);
}
