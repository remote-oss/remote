/**
 * @fileoverview Clone Repository in Container Volume, before the reload: the trust confirmation once per profile, the
 * engine check, the source the user gives, the access pre-check on the host, and the reload of the same window into
 * the volume payload. Nothing here creates a Docker object; the reloaded window's resolve does.
 */

import type {Logger} from 'lib-log';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import {cloneSourceOf, type CloneSource} from './clone-source.ts';
import type {PrecheckOutcome} from './precheck.ts';
import {
  type DevContainerVolume,
  UNIQUE_VOLUME,
  volumePayloadOf,
} from './volume-payload.ts';

/** The user's answer to the trust confirmation. */
export type CloneTrustAnswer = 'gotIt' | 'cancel' | 'learnMore';

/** What the command needs of the editor and the engine. */
export interface CloneCommandPorts {
  trust: {
    /** Whether the confirmation was accepted in this profile already. */
    accepted(): boolean;
    /** Shows the confirmation; Escape is `cancel`. */
    confirm(): Promise<CloneTrustAnswer>;
    remember(): Promise<void>;
    /** Opens our page about cloning what you trust. */
    learnMore(): void;
  };
  /** The engine check, which shows its own dialog when the engine isn't ready. */
  engineReady(): Promise<boolean>;
  /** The source the user gives: the text typed, or nothing when the pick was dismissed. */
  pickSource(): Promise<string | undefined>;
  precheck(
    source: CloneSource,
    cancellation: AbortSignal,
  ): Promise<PrecheckOutcome>;
  /** The modal error that names the repository that can't be read. */
  cannotAccess(repository: string): Promise<void>;
  /** The repository the window's own volume was cloned from, when the window is a volume workspace. */
  currentRepository(): string | undefined;
  /** The engine the window is pinned to, which the payload carries. */
  engine(): PinnedEngine;
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
export function uniqueVolumeTargetOf(
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
async function trusted(ports: CloneCommandPorts): Promise<boolean> {
  if (ports.trust.accepted()) {
    return true;
  }
  const answer = await ports.trust.confirm();
  if (answer === 'learnMore') {
    ports.trust.learnMore();
  }
  if (answer !== 'gotIt') {
    return false;
  }
  await ports.trust.remember();
  return true;
}

/** Runs the command once, up to the reload; every way it ends before then leaves the window as it was. */
export async function cloneInUniqueVolume(
  ports: CloneCommandPorts,
  cancellation: AbortSignal,
): Promise<void> {
  if (!(await trusted(ports)) || !(await ports.engineReady())) {
    return;
  }
  const typed = await ports.pickSource();
  if (typed === undefined) {
    return;
  }
  const source = cloneSourceOf(typed, 'typed');
  if ('refused' in source) {
    ports.logger.info(`the source was refused: ${source.refused}`);
    await ports.cannotAccess(typed.trim());
    return;
  }
  if (ports.currentRepository() === source.repositoryPath) {
    ports.logger.info('the window is the clone of this repository already');
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
  await ports.reload(
    volumeWindowUriOf(uniqueVolumeTargetOf(source, ports.engine())),
  );
}
