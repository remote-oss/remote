/**
 * @fileoverview The launch's window that replaces `local` when it connects to the harness host in place: the rows that
 * use it find the one an earlier row left, or make it.
 */

import {inWindow, isOpen, waitFor, windowNames} from '../windows/harness.ts';
import {rowAction} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';

/**
 * The launch's window that is connected to the harness host in the place of `local`: the one an earlier row left, or,
 * when none did, the one this call makes by connecting `local` in the current window. Its name is the first free one
 * of the launch, so the caller takes it from here.
 */
export async function reloadedWindow(): Promise<string> {
  function reloaded(): string | undefined {
    return windowNames().find(
      name => name.startsWith('empty-') && isOpen(name),
    );
  }
  const left = reloaded();
  if (left !== undefined) {
    return left;
  }
  await inWindow('local', 'remoteTargets.focus');
  await rowAction('local', VIEW, 'harness', 'Connect in Current Window...');
  await waitFor(
    'the window that replaces local to activate its agent',
    () => reloaded() !== undefined,
    60_000,
  );
  return reloaded() ?? '';
}
