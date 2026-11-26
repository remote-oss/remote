/**
 * @fileoverview The windows of the harness display through `xdotool` and `xprop`, the key driver the display step
 * installs: the window of a name, its activation through the window manager, the window the display's active window
 * is, and the display's visible windows at an instant, with their names, their WM_CLASS and their managedness. A
 * page read over the protocol cannot say what the window manager gave its active window to, so the display says it.
 * The activation asks
 * for the window the manager manages: `xdotool search` returns the children of a name as well, and a child window
 * takes no activation.
 */

import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** The environment of a display read: the process's, with the harness display as the default. */
function displayEnv(): NodeJS.ProcessEnv {
  return {...process.env, DISPLAY: process.env.DISPLAY ?? ':99'};
}

/** Runs `xdotool` with `words` on the harness display and gives its output. */
export async function drive(...words: string[]): Promise<string> {
  const {stdout} = await execFileAsync('xdotool', words, {
    env: displayEnv(),
  });
  return stdout.trim();
}

/** Runs `xdotool` with `words` on the harness display and waits for its output, so a readout can say the display's windows at once. */
function driveSync(...words: string[]): string {
  return execFileSync('xdotool', words, {
    env: displayEnv(),
    encoding: 'utf8',
  }).trim();
}

/** A key driver over the harness display that waits for each answer, so a readout can say the display's windows at once. */
export type KeyDriverSync = typeof driveSync;

/** The X window `id`'s `property` through `xprop`, giving its output. */
function xpropRead(windowId: string, property: string): string {
  return execFileSync('xprop', ['-id', windowId, property], {
    env: displayEnv(),
    encoding: 'utf8',
  });
}

/** Whether a window holds a WM_STATE, read at once: a window or display that is gone by the read says no. */
function hasWmStateSync(windowId: string): boolean {
  try {
    return xpropRead(windowId, 'WM_STATE').includes('WM_STATE(');
  } catch {
    return false;
  }
}

/** The X window `id`'s WM_CLASS, as `xprop` prints it after the `=`, none while the display gives it none. */
function windowClassOf(windowId: string): string {
  try {
    const printed = xpropRead(windowId, 'WM_CLASS');
    const equals = printed.indexOf('=');
    const value = equals < 0 ? '' : printed.slice(equals + 1).trim();
    return value === '' ? 'none' : value;
  } catch {
    return 'none';
  }
}

/** A key driver over the harness display: the harness installs `xdotool`, and a test stands a stand-in in its place. */
export type KeyDriver = typeof drive;

/** Reads the X window `id`'s WM_STATE on the harness display: a managed top-level holds it, and a child window does not. */
async function hasWmState(windowId: string): Promise<boolean> {
  try {
    await execFileAsync('xprop', ['-id', windowId, 'WM_STATE'], {
      env: displayEnv(),
    });
    return true;
  } catch (caught) {
    // xprop exits 123 when the property is absent, and a missing tool is no answer either.
    const code = (caught as {code?: unknown}).code;
    if (code === 123 || code === 'ENOENT') {
      return false;
    }
    throw caught;
  }
}

/** Whether a window is managed, read on the display, so a test can stand a display in for the harness's. */
export type WmReader = (windowId: string) => Promise<boolean>;

/** A window the display holds for a name, with whether the window manager manages it. */
export interface WindowCandidate {
  /** The X window id. */
  id: string;
  /** Whether the window holds a WM_STATE, which only a managed top-level does. */
  managed: boolean;
}

/** How long the window manager is given to confirm a `--sync` activation, in milliseconds. */
const SYNC_ACTIVATION_MILLISECONDS = 5_000;

/** `name` as the regular expression of `xdotool search --name`. */
function namePattern(name: string): string {
  return name.replace(/[\]\\()[\]{}|^$.*+]/g, '\\$&');
}

/** The windows of a name on the display through `driver`, with whether each is managed; none while the name is not visible. */
async function windowCandidatesOf(
  name: string,
  driver: KeyDriver,
  wmReader: WmReader,
): Promise<WindowCandidate[]> {
  let found: string;
  try {
    found = await driver(
      'search',
      '--onlyvisible',
      '--name',
      namePattern(name),
    );
  } catch (caught) {
    // `xdotool search` exits with 1 when no window matches; a driver that is missing or fails otherwise is no answer.
    if ((caught as {code?: unknown}).code === 1) {
      return [];
    }
    throw caught;
  }
  const candidates: WindowCandidate[] = [];
  for (const windowId of found.split('\n')) {
    if (windowId !== '') {
      candidates.push({id: windowId, managed: await wmReader(windowId)});
    }
  }
  return candidates;
}

/** The window the activation asks for among `candidates`: the last one the manager manages, and the last of them while none is managed. */
export function managedPick(
  candidates: readonly WindowCandidate[],
): string | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate?.managed) {
      return candidate.id;
    }
  }
  const last = candidates[candidates.length - 1];
  return last?.id;
}

/** The managed window of a name on the harness display, or nothing while the name is not visible. */
export async function displayWindow(name: string): Promise<string | undefined> {
  return managedPick(await windowCandidatesOf(name, drive, hasWmState));
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
  /** Every visible X window the name matched, with whether each is managed: the pick's candidates. */
  candidates: WindowCandidate[];
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
  wmReader: WmReader = hasWmState,
): Promise<ActivationOutcome> {
  const candidates = await windowCandidatesOf(name, driver, wmReader);
  const windowId = managedPick(candidates);
  if (windowId === undefined) {
    return {windowId: undefined, confirmed: false, candidates};
  }
  const confirmed = await syncConfirmed(driver, windowId, limitMilliseconds);
  return {windowId, confirmed, candidates};
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

/** Whether the display settles `words` within `limitMilliseconds`: a limit that passes, or a driver that fails, is no answer, so the wait around it goes on. */
async function settledWithin(
  driver: KeyDriver,
  limitMilliseconds: number,
  ...words: string[]
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const settled = await new Promise<boolean>(resolve => {
    timer = setTimeout(() => {
      resolve(false);
    }, limitMilliseconds);
    void driver(...words).then(
      () => {
        resolve(true);
      },
      () => {
        resolve(false);
      },
    );
  });
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  return settled;
}

/**
 * Gives the managed frame of window `name` the display's focus for a manager that may refuse it while another window
 * holds the focus: the frame is raised first, the manager's `--sync` activation is asked for with its limit as now,
 * and while the manager does not confirm it, the frame is asked for the focus plainly, so the wait around it goes on.
 */
export async function activateFrameWithin(
  name: string,
  driver: KeyDriver,
  limitMilliseconds: number = SYNC_ACTIVATION_MILLISECONDS,
  wmReader: WmReader = hasWmState,
): Promise<ActivationOutcome> {
  const candidates = await windowCandidatesOf(name, driver, wmReader);
  const windowId = managedPick(candidates);
  if (windowId === undefined) {
    return {windowId: undefined, confirmed: false, candidates};
  }
  await settledWithin(driver, limitMilliseconds, 'windowraise', windowId);
  const confirmed = await syncConfirmed(driver, windowId, limitMilliseconds);
  if (!confirmed) {
    await settledWithin(driver, limitMilliseconds, 'windowfocus', windowId);
  }
  return {windowId, confirmed, candidates};
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

/** A visible window on the display, with its name and whether the window manager manages it. */
export interface TopLevelWindow {
  /** The X window id. */
  id: string;
  /** The window's name, or none while the display gives it none. */
  name: string;
  /** Whether the window holds a WM_STATE, which only a managed top-level does. */
  managed: boolean;
}

/** The display's visible windows at a named instant of a row, so a focus wait that never settles says what the display held then. */
export interface WindowInstant {
  /** What the instant is, as the readout says it. */
  label: string;
  /** The display's visible windows then. */
  windows: TopLevelWindow[];
}

/** The display's visible windows through `driver` and `wmReader`, each with its name and whether the manager manages it; none while the display is not visible. */
export async function topLevelWindowsOf(
  driver: KeyDriver,
  wmReader: WmReader,
): Promise<TopLevelWindow[]> {
  let found: string;
  try {
    found = await driver('search', '--onlyvisible', '--name', '.*');
  } catch (caught) {
    // `xdotool search` exits with 1 when no window matches; a driver that is missing or fails otherwise is no answer.
    if ((caught as {code?: unknown}).code === 1) {
      return [];
    }
    throw caught;
  }
  const windows: TopLevelWindow[] = [];
  for (const windowId of found.split('\n')) {
    if (windowId !== '') {
      windows.push({
        id: windowId,
        name: await driver('getwindowname', windowId).catch(() => ''),
        managed: await wmReader(windowId),
      });
    }
  }
  return windows;
}

/** The display's visible windows on the harness display, each with its name and whether the manager manages it. */
export function topLevelWindows(): Promise<TopLevelWindow[]> {
  return topLevelWindowsOf(drive, hasWmState);
}

/** The windows of a list, as the readout says them: each with its name and whether the window manager manages it. */
export function windowsOf(windows: readonly TopLevelWindow[]): string {
  return windows
    .map(
      each =>
        `${each.id} (${each.name === '' ? 'no name' : each.name}, ${
          each.managed ? 'managed' : 'no WM_STATE'
        })`,
    )
    .join(', ');
}

/** A visible window on the display at a readout, with its name, its WM_CLASS and whether the window manager manages it. */
export interface ListedWindow {
  /** The X window id. */
  id: string;
  /** The window's name, or none while the display gives it none. */
  name: string;
  /** The window's WM_CLASS, as xprop prints it, or none while the display gives it none. */
  windowClass: string;
  /** Whether the window holds a WM_STATE, which only a managed top-level does. */
  managed: boolean;
}

/** The display's visible windows through `driver`, `wmReader` and `classReader`, with name, WM_CLASS and managedness. */
export function listedWindowsOf(
  driver: KeyDriverSync,
  wmReader: (windowId: string) => boolean,
  classReader: (windowId: string) => string,
): ListedWindow[] {
  let found: string;
  try {
    found = driver('search', '--onlyvisible', '--name', '.*');
  } catch (caught) {
    // `xdotool search` exits with 1 when no window matches, and a display that cannot be reached fails the same
    // way, saying so on its error: the empty answer without the error is the no-windows one.
    const error = caught as {status?: number; stderr?: string};
    if (error.status === 1 && (error.stderr ?? '').trim() === '') {
      return [];
    }
    throw caught;
  }
  const windows: ListedWindow[] = [];
  for (const windowId of found.split('\n')) {
    if (windowId !== '') {
      let name: string;
      try {
        name = driver('getwindowname', windowId);
      } catch {
        // A name the display does not give is none at the readout.
        name = '';
      }
      windows.push({
        id: windowId,
        name,
        windowClass: classReader(windowId),
        managed: wmReader(windowId),
      });
    }
  }
  return windows;
}

/** The display's visible windows on the harness display, each with its name, its WM_CLASS and whether the manager manages it. */
export function listedWindows(): ListedWindow[] {
  return listedWindowsOf(driveSync, hasWmStateSync, windowClassOf);
}
