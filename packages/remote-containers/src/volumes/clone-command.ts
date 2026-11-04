/**
 * @fileoverview Clone Repository in Container Volume, before the reload: the trust confirmation once per profile, the
 * engine check, the source the user gives, the access pre-check on the host, the record that the source was typed,
 * and the reload of the same window into the volume payload. Nothing here creates a Docker object; the reloaded window's resolve does.
 */

import type {Logger} from 'lib-log';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import {
  type CloneOrigin,
  cloneSourceOf,
  type CloneSource,
} from './clone-source.ts';
import type {PrecheckOutcome} from './precheck.ts';
import {type PickedRepository, pickedSourceOf} from './source-pick.ts';
import {
  type DevContainerVolume,
  UNIQUE_VOLUME,
  volumePayloadOf,
} from './volume-payload.ts';

/** The user's answer to the trust confirmation. */
export type CloneTrustAnswer = 'gotIt' | 'cancel' | 'learnMore';

/** The clone's trust confirmation: what the profile accepted, the dialog, its record, and our page about it. */
export interface CloneTrustPorts {
  /** Whether the confirmation was accepted in this profile already. */
  accepted(): boolean;
  /** Shows the confirmation; Escape is `cancel`. */
  confirm(): Promise<CloneTrustAnswer>;
  remember(): Promise<void>;
  /** Opens our page about cloning what you trust. */
  learnMore(): void;
}

/** What the command needs of the editor and the engine. */
export interface CloneCommandPorts {
  trust: CloneTrustPorts;
  /** The engine check, which shows its own dialog when the engine isn't ready. */
  engineReady(): Promise<boolean>;
  /** The source the user gives: the text typed, the GitHub row, or nothing when the pick was dismissed. */
  pickSource(): Promise<
    {kind: 'typed'; text: string} | {kind: 'github'} | undefined
  >;
  /** Picks a repository on GitHub, and its branch, through the editor's own remote sources; nothing when left. */
  pickGithub(): Promise<PickedRepository | undefined>;
  precheck(
    source: CloneSource,
    origin: CloneOrigin,
    cancellation: AbortSignal,
  ): Promise<PrecheckOutcome>;
  /** The modal error that names the repository that can't be read. */
  cannotAccess(repository: string): Promise<void>;
  /** The repository the window's own volume was cloned from, when the window is a volume workspace. */
  currentRepository(): string | undefined;
  /** The engine the window is pinned to, which the payload carries. */
  engine(): PinnedEngine;
  /** Records that the source of `payload` was typed, for the resolve after the reload. */
  recordTyped(payload: string): Promise<void>;
  /** Reloads this window on `uri`; core asks to save an untitled workspace first, and its Cancel drops the clone. */
  reload(uri: string): Promise<void>;
  logger: Logger;
}

/** The profile's record that the clone's trust confirmation was accepted (a key of ours). */
export const CLONE_TRUST_KEY =
  'remote-oss.remote-containers.cloneTrustAccepted';

/** Our page about cloning only what you trust, which the confirmation's Learn More opens. */
export const CLONE_TRUST_PAGE =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-containers/README.md#only-clone-what-you-trust';

/** The authority's prefix of a dev container window. */
const AUTHORITY_PREFIX = 'vscode-remote://dev-container+';

/** The volume payload of a source: a unique volume, named when the clone runs. */
function uniqueVolumeTargetOf(
  source: CloneSource,
  engine: PinnedEngine,
): DevContainerVolume {
  return {
    kind: 'volume',
    repositoryPath: source.repositoryPath,
    volumeName: UNIQUE_VOLUME,
    folder: source.repositoryName,
    cloneInfo: {
      urlToClone: source.urlToClone,
      ...(source.ref === undefined ? {} : {ref: source.ref}),
    },
    inspectVolume: false,
    ...engine,
  };
}

/** The URI of a volume target's window: its folder under `/workspaces`. */
export function volumeWindowUriOf(target: DevContainerVolume): string {
  return `${AUTHORITY_PREFIX}${volumePayloadOf(target)}/workspaces/${encodeURIComponent(target.folder)}`;
}

/** Whether the confirmation lets the clone go on, asking it the first time in the profile. */
export async function cloneConsented(trust: CloneTrustPorts): Promise<boolean> {
  if (trust.accepted()) {
    return true;
  }
  const answer = await trust.confirm();
  if (answer === 'learnMore') {
    trust.learnMore();
  }
  if (answer !== 'gotIt') {
    return false;
  }
  await trust.remember();
  return true;
}

/** The source text the user gives: typed, or the repository picked on GitHub; nothing when either pick was left. */
async function sourceTextOf(
  ports: CloneCommandPorts,
): Promise<string | undefined> {
  const picked = await ports.pickSource();
  if (picked?.kind !== 'github') {
    return picked?.text;
  }
  const repository = await ports.pickGithub();
  return repository === undefined ? undefined : pickedSourceOf(repository);
}

/**
 * The source `given` names once it is refused or found unreachable, each shown with S052, or found to be the window's
 * own repository; undefined in all three cases, and when the check was cancelled.
 */
async function reachableSource(
  ports: CloneCommandPorts,
  given: string,
  origin: CloneOrigin,
  cancellation: AbortSignal,
): Promise<CloneSource | undefined> {
  const source = cloneSourceOf(given, origin);
  if ('refused' in source) {
    ports.logger.info(`the source was refused: ${source.refused}`);
    await ports.cannotAccess(given.trim());
    return undefined;
  }
  if (ports.currentRepository() === source.repositoryPath) {
    ports.logger.info('the window is the clone of this repository already');
    return undefined;
  }
  const checked = await ports.precheck(source, origin, cancellation);
  if (checked === 'unreachable') {
    await ports.cannotAccess(source.repositoryPath);
  }
  return checked === 'reachable' ? source : undefined;
}

/**
 * Runs the command once, up to the reload; every way it ends before then leaves the window as it was. A `link` is a
 * source the extension was handed, such as the remote of a repository: it is read as a link, not as the user's own
 * input, and nothing is asked for it.
 */
export async function cloneInUniqueVolume(
  ports: CloneCommandPorts,
  cancellation: AbortSignal,
  link?: string,
): Promise<void> {
  if (!(await cloneConsented(ports.trust)) || !(await ports.engineReady())) {
    return;
  }
  const origin: CloneOrigin = link === undefined ? 'typed' : 'link';
  const given = link ?? (await sourceTextOf(ports));
  if (given === undefined) {
    return;
  }
  const source = await reachableSource(ports, given, origin, cancellation);
  if (source === undefined) {
    return;
  }
  const target = uniqueVolumeTargetOf(source, ports.engine());
  if (origin === 'typed') {
    await ports.recordTyped(volumePayloadOf(target));
  }
  await ports.reload(volumeWindowUriOf(target));
}

/**
 * Clones the repository an "Open in Dev Containers" link names, up to the reload. The engine and the repository are
 * checked before the confirmation, so a link that can't be cloned shows S052 alone; nothing is picked or recorded.
 */
export async function cloneFromLink(
  ports: CloneCommandPorts,
  link: string,
  cancellation: AbortSignal,
): Promise<void> {
  if (!(await ports.engineReady())) {
    return;
  }
  const source = await reachableSource(ports, link, 'link', cancellation);
  if (source === undefined || !(await cloneConsented(ports.trust))) {
    return;
  }
  await ports.reload(
    volumeWindowUriOf(uniqueVolumeTargetOf(source, ports.engine())),
  );
}
