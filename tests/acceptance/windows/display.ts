/**
 * @fileoverview The windows of the harness display through `xdotool`, the key driver the display step installs: the
 * window of a name, its activation through the window manager, and the window the display's active window is. A page
 * read over the protocol cannot say what the window manager gave its active window to, so the display says it.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** Runs `xdotool` with `words` on the harness display and gives its output. */
export async function drive(...words: string[]): Promise<string> {
  const {stdout} = await execFileAsync('xdotool', words, {
    env: {...process.env, DISPLAY: process.env.DISPLAY ?? ':99'},
  });
  return stdout.trim();
}

/** `name` as the regular expression of `xdotool search --name`. */
function namePattern(name: string): string {
  return name.replace(/[\]\\()[\]{}|^$.*+]/g, '\\$&');
}

/** The window `name` is on the harness display, or nothing while it is not visible. */
export async function displayWindow(name: string): Promise<string | undefined> {
  try {
    const found = await drive(
      'search',
      '--onlyvisible',
      '--name',
      namePattern(name),
    );
    const last = found.split('\n').at(-1) ?? '';
    return last === '' ? undefined : last;
  } catch (caught) {
    // `xdotool search` exits with 1 when no window matches; a driver that is missing or fails otherwise is no answer.
    if ((caught as {code?: unknown}).code === 1) {
      return undefined;
    }
    throw caught;
  }
}

/**
 * Gives window `name` the display's focus through the window manager, as a click on the window asks it, and waits for
 * the manager to confirm the change: it does nothing while the window is not visible, so a wait around it goes on.
 */
export async function activateWindow(name: string): Promise<void> {
  const windowId = await displayWindow(name);
  if (windowId === undefined) {
    return;
  }
  await drive('windowactivate', '--sync', windowId);
}

/** The name of the window the display's active window is, `none` when the display reports no active window. */
export async function activeWindowName(): Promise<string> {
  try {
    const name = await drive('getactivewindow', 'getwindowname');
    return name === '' ? 'none' : name;
  } catch (caught) {
    // No active window on a minimal manager is a no-answer, not a failure of the driver.
    if ((caught as {code?: unknown}).code === 1) {
      return 'none';
    }
    throw caught;
  }
}
