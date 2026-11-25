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

/** A key driver over the harness display: the harness installs `xdotool`, and a test stands a stand-in in its place. */
export type KeyDriver = typeof drive;

/** How long the window manager is given to confirm a `--sync` activation, in milliseconds. */
const SYNC_ACTIVATION_MILLISECONDS = 5_000;

/** `name` as the regular expression of `xdotool search --name`. */
function namePattern(name: string): string {
  return name.replace(/[\]\\()[\]{}|^$.*+]/g, '\\$&');
}

/** The window `name` is on the display through `driver`, or nothing while it is not visible. */
async function windowIdOf(
  name: string,
  driver: KeyDriver,
): Promise<string | undefined> {
  try {
    const found = await driver(
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

/** The window `name` is on the harness display, or nothing while it is not visible. */
export async function displayWindow(name: string): Promise<string | undefined> {
  return await windowIdOf(name, drive);
}

/**
 * The result of asking the window manager to give a window the display's focus, as the focus wait reads it: the window
 * the display held for it, and whether the manager confirmed the change within its limit.
 */
export interface ActivationOutcome {
  /** The window the display held for the name, or none while it was not visible. */
  windowId: string | undefined;
  /** Whether the window manager confirmed the activation within its limit. */
  confirmed: boolean;
}

/**
 * Gives window `name` the display's focus through the window manager, as a click on the window asks it, with a limit on
 * the manager's `--sync` confirmation: a limit that passes, or a manager that fails, is no answer, so the wait around it
 * goes on instead of hanging or failing.
 */
export async function activateWindowWithin(
  name: string,
  driver: KeyDriver,
  limitMilliseconds: number = SYNC_ACTIVATION_MILLISECONDS,
): Promise<ActivationOutcome> {
  const windowId = await windowIdOf(name, driver);
  if (windowId === undefined) {
    return {windowId: undefined, confirmed: false};
  }
  const confirmed = await syncConfirmed(driver, windowId, limitMilliseconds);
  return {windowId, confirmed};
}

/** Whether the window manager confirms `windowId`'s `--sync` activation within `limitMilliseconds`. */
async function syncConfirmed(
  driver: KeyDriver,
  windowId: string,
  limitMilliseconds: number,
): Promise<boolean> {
  const activation = driver('windowactivate', '--sync', windowId);
  let timer: NodeJS.Timeout | undefined;
  const outcome = await new Promise<'confirmed' | 'failed' | 'timedout'>(
    resolve => {
      timer = setTimeout(() => {
        resolve('timedout');
      }, limitMilliseconds);
      void activation.then(
        () => {
          resolve('confirmed');
        },
        () => {
          resolve('failed');
        },
      );
    },
  );
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  return outcome === 'confirmed';
}

/** The name of the window the display's active window is through `driver`, `none` when the display reports no active window. */
export async function activeWindowNameOf(driver: KeyDriver): Promise<string> {
  try {
    const name = await driver('getactivewindow', 'getwindowname');
    return name === '' ? 'none' : name;
  } catch (caught) {
    // No active window on a minimal manager is a no-answer, not a failure of the driver.
    if ((caught as {code?: unknown}).code === 1) {
      return 'none';
    }
    throw caught;
  }
}

/** The name of the window the display's active window is, `none` when the display reports no active window. */
export async function activeWindowName(): Promise<string> {
  return await activeWindowNameOf(drive);
}
