/**
 * @fileoverview The ports of the Reopen in Container command and its rebuild variants: what it reads of the window, the file system, the settings
 * and the engine, and the CLI and the opener it calls. Types only; the editor's adapters are made in `extension.ts`.
 */

import type {OpenerHost} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {SerializedUri} from '../authority/payload.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';
import type {ConfigurationPorts} from '../config/choose-configuration.ts';
import type {EngineDialogPort, FirstCheckResult} from '../engine/preflight.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import type {TrustOutcome} from '../trust/trust-gate.ts';
import type {OpenGatePorts} from './open-gate.ts';
import type {PreReloadProgressPorts} from './pre-reload-progress.ts';

/** What the command reads of the window it runs in, at each call. */
interface WindowPort {
  /** The name of the remote the window is on; none for a local window. */
  remoteName(): string | undefined;
  folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
  /** The editor's URI for a local file, as the payload writes it. */
  serializedFile(file: string): SerializedUri;
}

/** The Docker checks, over the package's engine. */
interface EnginePort {
  /** The first check, with the given dialogs. */
  firstCheck(
    base: string | undefined,
    dialogs: EngineDialogPort,
  ): Promise<FirstCheckResult>;
  /** The name of the current Docker context; none for the default one. */
  currentContext(dockerFile: string): Promise<string | undefined>;
}

/** Everything the command needs. */
export interface ReopenPorts {
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
  };
  engine: EnginePort;
  /** The dialogs of the first check. */
  dialogs: EngineDialogPort;
  /** The progress that shows while the checks before the reload take long. */
  progress: PreReloadProgressPorts;
  bridge: Pick<CliBridge, 'readConfiguration'>;
  opener: OpenerHost;
  logger: Logger;
}
