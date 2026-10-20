/**
 * @fileoverview The reload the open commands end with: the window opens on the dev container authority of a folder and
 * its chosen configuration, at the folder the container will show. A rebuild command leaves its intent for the resolve
 * right before it.
 */

import {encodeAuthority, openRemote, type OpenerHost} from 'lib-authority';
import type {Logger} from 'lib-log';
import {
  devContainerPayloadOf,
  type SerializedUri,
} from '../authority/payload.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import type {PreReloadProgress} from './pre-reload-progress.ts';
import {type RebuildOptions, storeRebuildIntent} from './rebuild-intent.ts';

/** What the reload reads of the editor and calls. */
export interface ReloadPorts {
  window: {
    /** The editor's URI for a local file, as the payload writes it. */
    serializedFile(file: string): SerializedUri;
  };
  engine: {
    /** The name of the current Docker context; none for the default one. */
    currentContext(dockerFile: string): Promise<string | undefined>;
  };
  opener: OpenerHost;
  shutdown: {
    /** Tells the shutdown helper that this window leaves the container it holds, before the reload. */
    leave(): Promise<void>;
  };
  logger: Logger;
}

/** What one reload is made of. */
export interface ReloadRequest {
  /** The title of the command, which the log names. */
  title: string;
  /** The host folder the container is for. */
  folder: string;
  /** The Docker executable the context is asked of. */
  dockerFile: string;
  chosen: {configFile: string; workspaceFolder: string};
  /** The progress of the checks, which closes before the reload. */
  progress: PreReloadProgress;
  /** Set by a rebuild command: the intent to leave, and where. */
  rebuild?: {options: RebuildOptions; intents: IntentMemento; now(): number};
}

/** Opens the window of this command on the folder's container; a refusal or a store that fails is logged, not thrown. */
export async function reloadIntoContainer(
  ports: ReloadPorts,
  request: ReloadRequest,
): Promise<void> {
  const {logger} = ports;
  const {title, folder, chosen, rebuild} = request;
  const context = await ports.engine.currentContext(request.dockerFile);
  const payload = devContainerPayloadOf({
    kind: 'folder',
    hostPath: folder,
    localDocker: false,
    ...(context === undefined ? {} : {context}),
    configFile: ports.window.serializedFile(chosen.configFile),
  });
  if (rebuild !== undefined) {
    try {
      await storeRebuildIntent(
        rebuild.intents,
        payload,
        rebuild.options,
        rebuild.now(),
      );
    } catch (error) {
      logger.warn(
        `the rebuild intent could not be stored: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
  }
  request.progress.close();
  await ports.shutdown.leave();
  const opened = await openRemote(
    ports.opener,
    encodeAuthority({
      family: 'dev-container',
      target: {payload},
      rawHostString: payload,
    }),
    {path: chosen.workspaceFolder, pathKind: 'folder', target: 'current'},
  );
  if (opened.kind === 'rejected') {
    logger.warn(`${title} was refused: ${opened.reason}`);
  }
}
