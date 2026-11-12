/**
 * @fileoverview Answers the operating system's own folder chooser, which the editor opens in place of its in-window
 * dialog when `files.simpleDialog.enable` is off. The chooser is a window of the harness display, not a part of the
 * page, so a key driver on that display types into it: `xdotool`, which the display step installs.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {waitFor} from '../windows/harness.ts';

const execFileAsync = promisify(execFile);

/** The title of the chooser's window. */
const CHOOSER_TITLE = 'Select Folder';

/** Runs `xdotool` with `words` on the harness display and gives its output. */
async function drive(...words: string[]): Promise<string> {
  const {stdout} = await execFileAsync('xdotool', words, {
    env: {...process.env, DISPLAY: process.env.DISPLAY ?? ':99'},
  });
  return stdout.trim();
}

/** The window the chooser is, or nothing while it is not open. */
async function chooserWindow(): Promise<string | undefined> {
  try {
    const found = await drive(
      'search',
      '--onlyvisible',
      '--name',
      CHOOSER_TITLE,
    );
    const last = found.split('\n').at(-1) ?? '';
    return last === '' ? undefined : last;
  } catch {
    return undefined;
  }
}

/**
 * Answers the open chooser with `folder`: it types the folder's path into the location entry, which makes the chooser
 * enter the folder, and presses the chooser's Open accelerator, which picks the folder it is in.
 */
export async function answerNativeFolderDialog(folder: string): Promise<void> {
  await waitFor(
    'the native folder chooser to open',
    async () => (await chooserWindow()) !== undefined,
    60_000,
  );
  const chooser = (await chooserWindow()) ?? '';
  await drive('windowactivate', '--sync', chooser);
  await drive('key', '--clearmodifiers', 'ctrl+l');
  await drive('type', '--clearmodifiers', '--delay', '60', folder);
  await drive('key', '--clearmodifiers', 'Return');
  await waitFor(
    'the chooser to take the folder',
    async () => {
      await drive('key', '--clearmodifiers', 'alt+o');
      return (await chooserWindow()) === undefined;
    },
    30_000,
  );
}
