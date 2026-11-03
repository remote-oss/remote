/**
 * @fileoverview Attach to Running Container: the warning, the checks of the Docker command, the picker over the running
 * containers, and the new window that opens on the container the user picks.
 */

import {
  type DecodedTarget,
  encodeAuthority,
  type OpenOutcome,
} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import type {EngineHost} from '../engine/engine-host.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  applicableConfigOf,
  type AttachConfigFiles,
  workspaceFolderOf,
} from './config-files.ts';
import {type AttachItem, runningItemsOf} from './containers.ts';
import {attachedSuffixOf} from './label.ts';
import {attachedPayloadOf} from './payload.ts';

/** The English templates of the dialogs this command shows. */
const COMMAND_TEMPLATES = {
  S365: 'There are no running containers to attach to.',
  S143: 'Docker returned an error.',
  confirm: 'OK',
} as const;

/** The picker over the running containers, while it is open. */
export interface AttachPicker {
  /** Fills the picker with its items and stops its busy state. */
  fill: (items: readonly AttachItem[]) => void;
  /** The item the user picked; none when the picker was dismissed. */
  chosen: Promise<AttachItem | undefined>;
  close: () => void;
}

/** Everything the command needs of the editor and the machine. */
export interface AttachPorts {
  /** The warning before the first attach of the profile; whether the command goes on. */
  warning(): Promise<boolean>;
  /** The checks of the Docker command, which show their own dialog for any outcome but a pass. */
  checks(cancellation: AbortSignal): Promise<'proceed' | 'stopped'>;
  /** The engine of the window; none when the settings name no Docker program. */
  engine(): EngineHost | undefined;
  /** Opens the picker, empty and busy. */
  openPicker(): AttachPicker;
  /** Shows a modal with a detail and one button. */
  showModal(
    message: string,
    detail: string,
    button: string,
  ): PromiseLike<unknown>;
  /** The files that may apply to a container with this image and name. */
  configFiles(image: string, name: string): AttachConfigFiles;
  exists(file: string): Promise<boolean>;
  readText(file: string): Promise<string>;
  /** The engine the window is pinned to; empty for the default one. */
  pinnedEngine(): Promise<PinnedEngine>;
  /** The distro's UNC root in a WSL window; none otherwise. */
  wslRoot(): string | undefined;
  registerLabel(decoded: DecodedTarget, suffix: string): void;
  /** Opens a new window on the authority, on the folder when there is one. */
  openWindow(
    authority: string,
    folder: string | undefined,
  ): Promise<OpenOutcome>;
  translate: Translate;
  logger: Logger;
  cancellation: AbortSignal;
}

/** The folder the attach file that applies names, or none. */
async function folderOf(
  ports: AttachPorts,
  item: AttachItem,
): Promise<string | undefined> {
  const file = await applicableConfigOf(
    ports.configFiles(item.image, item.name),
    file => ports.exists(file),
  );
  if (file === undefined) {
    return undefined;
  }
  try {
    return workspaceFolderOf(await ports.readText(file));
  } catch {
    ports.logger.warn(
      `the attach configuration file ${file} could not be read`,
    );
    return undefined;
  }
}

/** Runs the command. */
export async function attachToRunningContainer(
  ports: AttachPorts,
): Promise<void> {
  const {translate, logger} = ports;
  if (!(await ports.warning())) {
    return;
  }
  const engine = ports.engine();
  const checked = await ports.checks(ports.cancellation);
  if (engine === undefined || checked === 'stopped') {
    return;
  }
  const picker = ports.openPicker();
  const items = await runningItemsOf(engine, ports.cancellation);
  if ('failed' in items) {
    logger.warn(`the running containers could not be listed: ${items.failed}`);
    picker.close();
    await ports.showModal(
      translate(COMMAND_TEMPLATES.S143),
      items.failed,
      translate(COMMAND_TEMPLATES.confirm),
    );
    return;
  }
  if (items.length === 0) {
    picker.close();
    await ports.showModal(
      '',
      translate(COMMAND_TEMPLATES.S365),
      translate(COMMAND_TEMPLATES.confirm),
    );
    return;
  }
  picker.fill(items);
  const item = await picker.chosen;
  if (item === undefined) {
    return;
  }
  const folder = await folderOf(ports, item);
  const pinned = await ports.pinnedEngine();
  const wslRoot = ports.wslRoot();
  const payload = attachedPayloadOf({
    containerName: `/${item.name}`,
    ...pinned,
    ...(wslRoot === undefined ? {} : {cwd: wslRoot}),
  });
  const decoded: DecodedTarget = {
    family: 'attached-container',
    target: {payload},
    rawHostString: payload,
  };
  ports.registerLabel(
    decoded,
    attachedSuffixOf({image: item.image, name: item.name}, pinned, translate),
  );
  const opened = await ports.openWindow(encodeAuthority(decoded), folder);
  if (opened.kind === 'rejected') {
    logger.warn(`Attach to Running Container was refused: ${opened.reason}`);
  }
}
