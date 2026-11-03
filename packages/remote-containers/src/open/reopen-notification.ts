/**
 * @fileoverview The notification a local window shows when its folder, or a root of its workspace, holds a dev container
 * configuration: reopen it in its container, or stop asking for this folder or workspace, or for every one. Whether it
 * is suppressed is kept in the extension's own storage, as the time of the choice against the time of the last reset.
 */

import type {Logger} from 'lib-log';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import {
  CONTAINERS_INTRODUCTION,
  MOUNT_PERFORMANCE_PAGE,
} from '../surfaces/recovery-presenter.ts';
import type {IntentMemento} from '../state/timed-store.ts';

/** Our key in the global and the workspace storage; neither is synced. */
export const REOPEN_NOTIFICATION_KEY =
  'remote-oss.remote-containers.reopenNotification';

/** The English templates of the notification, by their string ids. */
const REOPEN_TEMPLATES = {
  S426: '{0} Reopen folder to develop in a container ([learn more]({2})).{1}',
  S427: '{0} Reopen workspace to develop in a container ([learn more]({2})).{1}',
  S186: 'Folder contains a Dev Container configuration file.',
  S405: 'Workspace contains a Dev Container configuration file.',
  S073: 'Clone in Volume',
  /** The sentence that offers the clone; the tail of the notification's first one, so it starts with a space. */
  cloneOffer:
    ' Or: Clone repository in Docker volume for [better I/O performance]({0}).',
  S368: 'There is a [Dev Container configuration](command:remote-containers.openDevContainerFile) available for this repository.',
  S293: 'Reopen in Container',
  S150: "Don't Show Again...",
  S151: "Don't show again for the current folder or for any folder?",
  S152: "Don't show again for the current workspace or for any workspace?",
  S035: 'Any Folder',
  S036: 'Any Workspace',
  S101: 'Current Folder',
  S102: 'Current Workspace',
} as const;

/** What a window is, as far as the notification cares. */
interface NotificationWindow {
  remote: boolean;
  /** Whether the window shows no workspace file, a saved `.code-workspace` file, or an unsaved multi-root workspace. */
  workspace: 'none' | 'saved' | 'untitled';
  /** The workspace folders, in order. */
  folders: ReadonlyArray<{scheme: string; fsPath: string}>;
}

/** Everything the notification needs. */
export interface ReopenNotificationPorts {
  window: NotificationWindow;
  global: IntentMemento;
  workspace: IntentMemento;
  /** Where the folder's configuration is: none, the folder's own, or an external one (stored or mirrored), which wins when both exist. */
  configurationKind(folder: string): Promise<'none' | 'folder' | 'external'>;
  /**
   * The clone in a volume that the notification offers a folder with a Git remote, on a host that is not Linux; none on
   * a Linux host. It names the remote a folder can be cloned from, and starts the clone of that remote.
   */
  cloning?: {
    remoteOf(folder: string): Promise<string | undefined>;
    start(remote: string): PromiseLike<unknown>;
  };
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

/** How a kind of window words its notification and its follow-up: the skeleton, the choices and the log words. */
interface Wording {
  skeleton: string;
  scopeQuestion: string;
  anyChoice: string;
  currentChoice: string;
  noun: 'folder' | 'workspace';
}

/** What the notification is for a window: shown or not, and the wording of the first sentence and of the rest. */
interface Offer {
  wording: Wording;
  /** Whether the first sentence is the plain one, S186 or S405, and not the repository-configuration one, S368. */
  plain: boolean;
}

/** The offer a window gets over the configuration kind of each of its roots, or none when nothing is to be shown. */
function offerFor(
  workspace: NotificationWindow['workspace'],
  kinds: ReadonlyArray<'none' | 'folder' | 'external'>,
): Offer | undefined {
  if (kinds.every(kind => kind === 'none')) {
    return undefined;
  }
  const folderWording: Wording = {
    skeleton: REOPEN_TEMPLATES.S426,
    scopeQuestion: REOPEN_TEMPLATES.S151,
    anyChoice: REOPEN_TEMPLATES.S035,
    currentChoice: REOPEN_TEMPLATES.S101,
    noun: 'folder',
  };
  if (workspace === 'none') {
    return {wording: folderWording, plain: kinds[0] === 'folder'};
  }
  if (workspace === 'untitled') {
    // An untitled workspace is worded as a folder, and its first sentence is always the repository-configuration one.
    return {wording: folderWording, plain: false};
  }
  return {
    wording: {
      skeleton: REOPEN_TEMPLATES.S427,
      scopeQuestion: REOPEN_TEMPLATES.S152,
      anyChoice: REOPEN_TEMPLATES.S036,
      currentChoice: REOPEN_TEMPLATES.S102,
      noun: 'workspace',
    },
    plain: kinds.includes('folder'),
  };
}

/**
 * Offers to reopen the window in its container, once: the folder of a window with one, or a saved or unsaved workspace
 * when any of its roots has a configuration. The user data variant is for a configuration newly written to the store,
 * which the folder's own files do not show, and is for a window with one folder only.
 */
export async function offerReopen(
  ports: ReopenNotificationPorts,
  variant: NotificationVariant = 'folder',
): Promise<void> {
  const {window, translate, logger} = ports;
  const roots = window.folders;
  if (
    window.remote ||
    roots.length === 0 ||
    roots.some(root => root.scheme !== 'file') ||
    (window.workspace === 'none' && roots.length !== 1) ||
    (window.workspace === 'untitled' && roots.length < 2) ||
    (variant === 'userData' && window.workspace !== 'none') ||
    isSuppressed(
      ports.global.get(REOPEN_NOTIFICATION_KEY),
      ports.workspace.get(REOPEN_NOTIFICATION_KEY),
    )
  ) {
    return;
  }
  const kinds =
    variant === 'userData'
      ? ['external' as const]
      : await Promise.all(
          roots.map(root => ports.configurationKind(root.fsPath)),
        );
  const offer = offerFor(window.workspace, kinds);
  if (offer === undefined) {
    return;
  }
  const {wording} = offer;
  const reopen = translate(REOPEN_TEMPLATES.S293);
  const suppress = translate(REOPEN_TEMPLATES.S150);
  const first =
    wording.noun === 'workspace' && offer.plain
      ? REOPEN_TEMPLATES.S405
      : offer.plain
        ? REOPEN_TEMPLATES.S186
        : REOPEN_TEMPLATES.S368;
  const [only] = roots;
  const remote =
    window.workspace === 'none' && only !== undefined
      ? await ports.cloning?.remoteOf(only.fsPath)
      : undefined;
  const clone = translate(REOPEN_TEMPLATES.S073);
  const answer = await ports.show(
    filled(translate, wording.skeleton, [
      translate(first),
      remote === undefined
        ? ''
        : filled(translate, REOPEN_TEMPLATES.cloneOffer, [
            MOUNT_PERFORMANCE_PAGE,
          ]),
      CONTAINERS_INTRODUCTION,
    ]),
    remote === undefined ? [reopen, suppress] : [reopen, clone, suppress],
  );
  if (remote !== undefined && answer === clone) {
    logger.info('the reopen notification: clone in a volume');
    await ports.cloning?.start(remote);
    return;
  }
  if (answer === reopen) {
    logger.info('the reopen notification: reopen');
    await ports.reopen();
    return;
  }
  if (answer !== suppress) {
    return;
  }
  const anyChoice = translate(wording.anyChoice);
  const currentChoice = translate(wording.currentChoice);
  const scope = await ports.show(translate(wording.scopeQuestion), [
    anyChoice,
    currentChoice,
  ]);
  if (scope === anyChoice) {
    logger.info(`the reopen notification: suppressed for any ${wording.noun}`);
    await store(ports.global, 'suppressedAt', ports.now());
  } else if (scope === currentChoice) {
    logger.info(`the reopen notification: suppressed for this ${wording.noun}`);
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
