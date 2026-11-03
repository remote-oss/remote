/**
 * @fileoverview Clone Repository in Named Container Volume, before the reload: the shared trust confirmation and
 * the source's pre-check, then this command's own steps, the volume pick, the volume-name box with its live checks
 * and its collision at submit, and the folder-name box. Nothing here creates a Docker object; the reloaded window's
 * resolve does. Escape anywhere, and Enter on an empty folder name, aborts the whole command silently.
 */

import type {PinnedEngine} from '../engine/effective-engine.ts';
import {
  type CloneCommandPorts,
  givenSourceOf,
  volumeWindowUriOf,
} from './clone-command.ts';
import type {CloneSource} from './clone-source.ts';
import {type DevContainerVolume, volumePayloadOf} from './volume-payload.ts';
import {type NamedVolumeFact} from './clone-volume.ts';
import {folderDefaultOf} from './volume-name-rules.ts';

/** What the named-volume command needs of the editor and the engine, over the clone command's ports. */
export interface NamedVolumeCommandPorts extends CloneCommandPorts {
  /** The named volumes the pick lists: their Docker names and creation dates, as the engine gives them. */
  namedVolumes(): Promise<readonly NamedVolumeFact[]>;
  /** The user's pick of a volume: an existing name, `null` to create a new one, or `undefined` when the pick closed. */
  pickVolume(
    volumes: readonly NamedVolumeFact[],
  ): Promise<string | null | undefined>;
  /** The volume-name box: the accepted name, or `undefined` when the box closed without accepting. */
  volumeName(): Promise<string | undefined>;
  /** Whether a Docker volume of `name` exists, across the whole daemon, listed by the pick or not. */
  volumeExists(name: string): Promise<boolean>;
  /** The modal that a volume name that exists already ends the attempt with. */
  volumeAlreadyExists(): Promise<void>;
  /** The folder-name box, prefilled with `defaultFolder`: the accepted value, which may be empty, or `undefined` when the box closed. */
  folderName(defaultFolder: string): Promise<string | undefined>;
  /** What this window is connected to, when it is a volume workspace: the clone that opened it. */
  currentClone():
    {repositoryPath: string; volumeName: string; folder: string} | undefined;
}

/** The volume payload of a named target: the picked volume and folder, named literally. */
function namedVolumeTargetOf(
  source: CloneSource,
  volumeName: string,
  folder: string,
  engine: PinnedEngine,
): DevContainerVolume {
  return {
    kind: 'volume',
    repositoryPath: source.repositoryPath,
    volumeName,
    folder,
    cloneInfo: {
      urlToClone: source.urlToClone,
      ...(source.ref === undefined ? {} : {ref: source.ref}),
    },
    inspectVolume: false,
    ...engine,
  };
}

/** Runs the command once, up to the reload; every way it ends before then leaves the window as it was. */
export async function cloneInNamedVolume(
  ports: NamedVolumeCommandPorts,
  cancellation: AbortSignal,
): Promise<void> {
  const source = await givenSourceOf(ports);
  if (source === undefined) {
    return;
  }
  const checked = await ports.precheck(source, cancellation);
  if (checked === 'cancelled') {
    return;
  }
  if (checked === 'unreachable') {
    await ports.cannotAccess(source.repositoryPath);
    return;
  }
  const picked = await ports.pickVolume(await ports.namedVolumes());
  if (picked === undefined) {
    return;
  }
  let volumeName: string | undefined;
  if (picked === null) {
    volumeName = await ports.volumeName();
  } else {
    volumeName = picked;
  }
  if (volumeName === undefined) {
    return;
  }
  if (picked === null && (await ports.volumeExists(volumeName))) {
    await ports.volumeAlreadyExists();
    return;
  }
  const folder = await ports.folderName(folderDefaultOf(source));
  if (folder === undefined || folder === '') {
    return;
  }
  const current = ports.currentClone();
  if (
    current?.repositoryPath === source.repositoryPath &&
    current.volumeName === volumeName &&
    current.folder === folder
  ) {
    ports.logger.info('the window is connected to this clone already');
    return;
  }
  const target = namedVolumeTargetOf(
    source,
    volumeName,
    folder,
    ports.engine(),
  );
  await ports.recordTyped(volumePayloadOf(target));
  await ports.reload(volumeWindowUriOf(target));
}
