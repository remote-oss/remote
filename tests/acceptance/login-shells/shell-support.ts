import {
  closeWindow,
  connectedWithin,
  inWindow,
  onHostAs,
  openWindow,
  appendScript,
  recordLines,
  runProcessTask,
  terminalNamed,
  waitFor,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';

/** Writes `text` as `file` under the home folder of host user `user`; the text goes through base64, so any text is safe. */
export async function writeHomeFile(
  user: string,
  file: string,
  text: string,
): Promise<void> {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  await onHostAs(
    user,
    'sh',
    '-c',
    `mkdir -p "$(dirname "$HOME/${file}")" && printf %s '${encoded}' | base64 -d > "$HOME/${file}"`,
  );
}

/** Removes the files `files` under the home folder of host user `user`. */
export async function removeHomeFiles(
  user: string,
  ...files: string[]
): Promise<void> {
  await onHostAs(
    user,
    'sh',
    '-c',
    `cd "$HOME" && rm -rf ${files.map(each => `'${each}'`).join(' ')}`,
  );
}

/** Whether a server of the editor runs as host user `user`. */
async function serverRuns(user: string): Promise<boolean> {
  const output = await onHostAs(
    user,
    'sh',
    '-c',
    'pgrep -u "$(id -u)" -f "[v]scodium-server-insiders" || true',
  );
  return output.trim() !== '';
}

/** Stops the server of host user `user`, so that the next connect starts one that reads the startup files again. */
export async function stopServer(user: string): Promise<void> {
  await onHostAs(
    user,
    'sh',
    '-c',
    'pkill -u "$(id -u)" -f "[v]scodium-server-insiders" || true',
  );
  await waitFor(
    `the server of ${user} to stop`,
    async () => !(await serverRuns(user)),
    30_000,
  );
}

/** Opens window `window` on the alias of host user `user`, connects it, runs `body`, and closes the window. */
export async function withWindow<Result>(
  user: string,
  window: string,
  body: () => Promise<Result>,
): Promise<Result> {
  await openWindow(user, window);
  try {
    await connectedWithin(window, INSTALL_MILLISECONDS);
    return await body();
  } finally {
    await closeWindow(window);
  }
}

/** The environment the server of `window` gives a task, as a map: the task writes it to a file that is read as `user`. */
export async function taskEnvironment(
  window: string,
  user: string,
  label: string,
): Promise<Record<string, string>> {
  const file = `/tmp/${label}-env`;
  await runProcessTask(window, '/bin/sh', ['-c', `env > ${file}`]);
  const text = await onHostAs(user, 'cat', file);
  await onHostAs(user, 'rm', '-f', file);
  return Object.fromEntries(
    text
      .split('\n')
      .filter(line => line.includes('='))
      .map(line => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
}

/** Opens a new terminal in `window` and gives whether one is named after `shell`. */
export async function newTerminalIs(
  window: string,
  shell: string,
): Promise<boolean> {
  await inWindow(window, 'workbench.action.terminal.new');
  return terminalNamed(window, shell);
}

/** The lines of the record of `window` for a surface: the notices, the failure dialogs. */
export function surfaceLines(window: string, surface: string): string[] {
  return recordLines(surface, window).map(line => line.question);
}

/** The failure dialog and the pick lines of a window whose connect failed. */
export interface FailedConnect {
  /** The first failure dialog: its text, its buttons, and the milliseconds from the window's opening to it. */
  dialog: {question: string; buttons: string[]; milliseconds: number};
}

/**
 * Opens window `window` on the alias of host user `user`, with the dialog of its failure and the pick after it
 * dismissed, and gives that dialog once it is shown.
 */
export async function failedOn(
  user: string,
  window: string,
  wait = 120_000,
): Promise<FailedConnect> {
  appendScript([...dismissals(window)]);
  const began = Date.now();
  await openWindow(user, window);
  await waitFor(
    `the failure dialog of ${window}`,
    () => recordLines('failureDialog', window).some(line => line.time >= began),
    wait,
  );
  const line = recordLines('failureDialog', window).find(
    each => each.time >= began,
  );
  return {
    dialog: {
      question: line?.question ?? '',
      buttons: line?.buttons ?? [],
      milliseconds: (line?.time ?? began) - began,
    },
  };
}

/**
 * Makes the next connect of host user `user` start everything again: every window but the local one is closed and the
 * shared SSH helper with it, so that no layer one captured earlier is kept, and the user's server is stopped.
 */
export async function freshServer(user: string): Promise<void> {
  await closeAllButLocal();
  await stopServer(user);
}
