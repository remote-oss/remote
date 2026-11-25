/**
 * @fileoverview Answers the operating system's own folder chooser, which the editor opens in place of its in-window
 * dialog when `files.simpleDialog.enable` is off. The chooser is a window of the harness display, not a part of the
 * page, so a key driver on that display types into it: `xdotool`, which the display step installs.
 */

import {waitFor} from '../windows/harness.ts';
import {drive, displayWindow} from '../windows/display.ts';

/** The title of the chooser's window. */
const CHOOSER_TITLE = 'Select Folder';

/** How long the chooser is given to take each key: it drops those that come before it has drawn the field they go to. */
const KEY_PAUSE_MILLISECONDS = 1000;

/** Waits for the chooser to take the key it was sent. */
function pause(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, KEY_PAUSE_MILLISECONDS));
}

/**
 * Answers the open chooser with `folder`: it types the folder's path into the location entry, which makes the chooser
 * enter the folder, and presses the chooser's Open accelerator, which picks the folder it is in.
 */
export async function answerNativeFolderDialog(folder: string): Promise<void> {
  await waitFor(
    'the native folder chooser to open',
    async () => (await displayWindow(CHOOSER_TITLE)) !== undefined,
    60_000,
  );
  const chooser = (await displayWindow(CHOOSER_TITLE)) ?? '';
  await drive('windowactivate', '--sync', chooser);
  await pause();
  await drive('key', '--clearmodifiers', 'ctrl+l');
  await pause();
  await drive('type', '--clearmodifiers', '--delay', '60', folder);
  await pause();
  await drive('key', '--clearmodifiers', 'Return');
  await pause();
  await waitFor(
    'the chooser to take the folder',
    async () => {
      await drive('key', '--clearmodifiers', 'alt+o');
      return (await displayWindow(CHOOSER_TITLE)) === undefined;
    },
    30_000,
  );
}
