/**
 * @fileoverview The notification a local window with one folder shows when the folder holds a dev container
 * configuration: reopen the folder in its container, or stop asking for this folder or for every folder. Whether it
 * is suppressed is kept in the extension's own storage, as the time of the choice against the time of the last reset.
 */

import type {Logger} from 'lib-log';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import {CONTAINERS_INTRODUCTION} from '../surfaces/recovery-presenter.ts';
import type {IntentMemento} from '../state/timed-store.ts';

/** Our key in the global and the workspace storage; neither is synced. */
export const REOPEN_NOTIFICATION_KEY =
  'remote-oss.remote-containers.reopenNotification';

/** The English templates of the notification, by their string ids. */
const REOPEN_TEMPLATES = {
  S426: '{0} Reopen folder to develop in a container ([learn more]({2})).{1}',
  S186: 'Folder contains a Dev Container configuration file.',
  S368: 'There is a [Dev Container configuration](command:remote-containers.openDevContainerFile) available for this repository.',
  S293: 'Reopen in Container',
  S150: "Don't Show Again...",
  S151: "Don't show again for the current folder or for any folder?",
  S035: 'Any Folder',
  S101: 'Current Folder',
} as const;

/** What a window is, as far as the notification cares. */
interface NotificationWindow {
  remote: boolean;
  workspaceFile: boolean;
  /** The workspace folders, in order. */
  folders: ReadonlyArray<{scheme: string; fsPath: string}>;
}

/** Everything the notification needs. */
export interface ReopenNotificationPorts {
  window: NotificationWindow;
  global: IntentMemento;
  workspace: IntentMemento;
  /** Where the folder's configuration is: none, the folder's own, or a stored one (which wins when both exist). */
  configurationKind(folder: string): Promise<'none' | 'folder' | 'stored'>;
  show(
    message: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  reopen(): PromiseLike<unknown>;
  now(): number;
  translate: Translate;
  logger: Logger;
}

/** What a stored value keeps: when the user chose not to be asked, and when the choices were last reset. */
interface StoredChoice {
  suppressedAt?: number;
  resetAt?: number;
}

/** The stored value as an object whose fields are finite numbers; anything else counts as absent. */
function choiceOf(stored: unknown): StoredChoice {
  if (typeof stored !== 'object' || stored === null) {
    return {};
  }
  const fields = stored as Record<string, unknown>;
  const choice: StoredChoice = {};
  for (const field of ['suppressedAt', 'resetAt'] as const) {
    const value = fields[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      choice[field] = value;
    }
  }
  return choice;
}

/** Whether the choice of the user is newer than the last reset. */
function suppressedAfter(choice: StoredChoice, reset: number): boolean {
  return (choice.suppressedAt ?? -Infinity) > reset;
}

/** Whether a stored global and workspace choice suppress the notification: a choice newer than the last reset does. */
export function isSuppressed(global: unknown, workspace: unknown): boolean {
  const globalChoice = choiceOf(global);
  const reset = globalChoice.resetAt ?? -Infinity;
  return (
    suppressedAfter(globalChoice, reset) ||
    suppressedAfter(choiceOf(workspace), reset)
  );
}

/** Writes `time` as the field of the object stored under the key, keeping its other fields. */
async function store(
  memento: IntentMemento,
  field: keyof StoredChoice,
  time: number,
): Promise<void> {
  await memento.update(REOPEN_NOTIFICATION_KEY, {
    ...choiceOf(memento.get(REOPEN_NOTIFICATION_KEY)),
    [field]: time,
  });
}

/** Where the configuration the notification speaks of is: in the folder, or in the extension's store of user data. */
export type NotificationVariant = 'folder' | 'userData';

/**
 * Offers to reopen the window's folder in its container, once. The user data variant is for a configuration newly
 * written to the store, which the folder's own files do not show.
 */
export async function offerReopen(
  ports: ReopenNotificationPorts,
  variant: NotificationVariant = 'folder',
): Promise<void> {
  const {window, translate, logger} = ports;
  const [folder] = window.folders;
  if (
    window.remote ||
    window.workspaceFile ||
    window.folders.length !== 1 ||
    folder?.scheme !== 'file' ||
    isSuppressed(
      ports.global.get(REOPEN_NOTIFICATION_KEY),
      ports.workspace.get(REOPEN_NOTIFICATION_KEY),
    )
  ) {
    return;
  }
  const kind =
    variant === 'userData'
      ? 'stored'
      : await ports.configurationKind(folder.fsPath);
  if (kind === 'none') {
    return;
  }
  const reopen = translate(REOPEN_TEMPLATES.S293);
  const suppress = translate(REOPEN_TEMPLATES.S150);
  const answer = await ports.show(
    filled(translate, REOPEN_TEMPLATES.S426, [
      translate(
        kind === 'folder' ? REOPEN_TEMPLATES.S186 : REOPEN_TEMPLATES.S368,
      ),
      '',
      CONTAINERS_INTRODUCTION,
    ]),
    [reopen, suppress],
  );
  if (answer === reopen) {
    logger.info('the reopen notification: reopen');
    await ports.reopen();
    return;
  }
  if (answer !== suppress) {
    return;
  }
  const anyFolder = translate(REOPEN_TEMPLATES.S035);
  const currentFolder = translate(REOPEN_TEMPLATES.S101);
  const scope = await ports.show(translate(REOPEN_TEMPLATES.S151), [
    anyFolder,
    currentFolder,
  ]);
  if (scope === anyFolder) {
    logger.info('the reopen notification: suppressed for any folder');
    await store(ports.global, 'suppressedAt', ports.now());
  } else if (scope === currentFolder) {
    logger.info('the reopen notification: suppressed for this folder');
    await store(ports.workspace, 'suppressedAt', ports.now());
  }
}

/** The reset command: a newer reset time, so that earlier choices no longer suppress, and nothing deleted. */
export async function resetReopenNotification(
  global: IntentMemento,
  now: number,
): Promise<void> {
  await store(global, 'resetAt', now);
}
