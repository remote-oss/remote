/**
 * @fileoverview The ports of the Reopen in Container command: what it reads of the window, the file system, the settings
 * and the engine, and the CLI and the opener it calls. Types only; the editor's adapters are made in `extension.ts`.
 */

import type {OpenerHost} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {SerializedUri} from '../authority/payload.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';
import type {ConfigurationPorts} from '../config/choose-configuration.ts';

/** What the command reads of the window it runs in, at each call. */
interface WindowPort {
  /** The name of the remote the window is on; none for a local window. */
  remoteName(): string | undefined;
  folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
  isTrusted(): boolean;
  /** The editor's URI for a local file, as the payload writes it. */
  serializedFile(file: string): SerializedUri;
}

/** The Docker checks, over the package's engine. */
interface EnginePort {
  /** The first check, with its own dialogs. */
  firstCheck(base: string | undefined): Promise<'proceed' | 'stopped'>;
  /** The name of the current Docker context; none for the default one. */
  currentContext(dockerFile: string): Promise<string | undefined>;
}

/** Everything the command needs. */
export interface ReopenPorts {
  window: WindowPort;
  config: Omit<ConfigurationPorts, 'cli' | 'logger'>;
  settings: {dockerPath(): unknown};
  engine: EnginePort;
  bridge: Pick<CliBridge, 'readConfiguration'>;
  opener: OpenerHost;
  logger: Logger;
}
