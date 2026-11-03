/**
 * @fileoverview The ports of the Reopen in Container command and its rebuild variants: what it reads of the window, the file system, the settings
 * and the engine, and the CLI and the opener it calls. Types only; the editor's adapters are made in `extension.ts`.
 */

import type {OpenerHost} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {SerializedUri} from '../authority/payload.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';
import type {ProblematicPorts} from '../features/problematic-check.ts';
import type {ConfigurationPorts} from '../config/choose-configuration.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {EngineDialogPort, FirstCheckResult} from '../engine/preflight.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import type {TrustOutcome} from '../trust/trust-gate.ts';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import type {AuthoringPort} from './author-first.ts';
import type {OpenGatePorts} from './open-gate.ts';
import type {PreReloadProgressPorts} from './pre-reload-progress.ts';
import type {WorkspaceFolderPorts} from './workspace-folders.ts';

/** What the command reads of the window it runs in, at each call. */
interface WindowPort {
  /** The name of the remote the window is on; none for a local window. */
  remoteName(): string | undefined;
  folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
  /** The workspace file the window shows: a `file` one for a saved workspace, an `untitled` one for an unsaved one; none for a folder. */
  workspaceFile(): {scheme: string; fsPath: string} | undefined;
  /** The editor's URI for a local file, as the payload writes it. */
  serializedFile(file: string): SerializedUri;
}

/** The Docker checks, over the package's engine. */
interface EnginePort {
  /** The first check, with the given dialogs. */
  firstCheck(
    base: string | undefined,
    dialogs: EngineDialogPort,
    cancellation?: AbortSignal,
  ): Promise<FirstCheckResult>;
  /** The engine the window is pinned to; empty for the default one. */
  pinnedEngine(dockerFile: string): Promise<PinnedEngine>;
}

/** Everything the command needs. */
export interface ReopenPorts extends AuthoringPort, WorkspaceFolderPorts {
  /** The guard of the open path, which holds the command back while a proposal it needs is missing. */
  gate: OpenGatePorts;
  window: WindowPort;
  /** The trust check of the window's folder, which asks the editor's dialog when the folder isn't trusted yet. */
  ensureTrusted(commandTitle: string): Promise<TrustOutcome>;
  /** Where a rebuild leaves its intent for the resolve that follows the reload. */
  intents: IntentMemento;
  now(): number;
  config: Omit<ConfigurationPorts, 'cli' | 'logger'>;
  settings: {
    dockerPath(): unknown;
    /** The user's value of `dev.containers.experimentalMountGitWorktreeCommonDir`, `undefined` when unset. */
    mountGitWorktreeCommonDir(): unknown;
    /** The user's value of `dev.containers.defaultFeatures`, `undefined` when unset. */
    defaultFeatures(): unknown;
    /** The user's value of `dev.containers.lockfile`, `undefined` when unset. */
    lockfile(): unknown;
  };
  engine: EnginePort;
  /** The dialogs of the first check. */
  dialogs: EngineDialogPort;
  /** Tells the user, in a modal information dialog with the detail `text` and one OK button, that the command cannot go on. */
  informModal(text: string): PromiseLike<unknown>;
  translate: Translate;
  /** The progress that shows while the checks before the reload take long. */
  progress: PreReloadProgressPorts;
  /** The time now, in milliseconds. */
  clock(): number;
  bridge: Pick<CliBridge, 'readConfiguration'>;
  /** The check of the Features against the control manifest, once a configuration is chosen. */
  problematic: ProblematicPorts;
  opener: OpenerHost;
  /** Tells the shutdown helper that this window leaves the container it holds, before the window reloads elsewhere. */
  shutdown: {leave(): Promise<void>};
  logger: Logger;
}
