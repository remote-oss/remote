/**
 * @fileoverview The helper process of a shared connection: it reads what its client passed as start values, builds
 * the `ssh` run with a SOCKS forward, serves the windows, and removes its registry record when it ends.
 */

import {
  type EndpointPort,
  type HelperParameters,
  type RegistryFilePort,
  type Scheduler,
  serve,
  type ServeEnd,
} from 'lib-helper';
import {askpassEnvironment} from '../askpass/environment.ts';
import {installLauncher, type LauncherFiles} from '../askpass/launcher.ts';
import {askpassEndpointPath} from '../askpass/paths.ts';
import {buildInvocation, type SshRequest} from '../arguments/invocation.ts';
import type {ProcessSpawner} from '../process/ports.ts';
import {ConnectionHandler} from './handler.ts';

/** The start values a client gives the helper in `HelperParameters.options`. */
export interface ConnectionHelperOptions {
  /** The `ssh` request as JSON, without its forwards. */
  request: string;
  /** The loopback port the helper forwards as SOCKS. */
  socksPort: number;
  /** The bound on the connect wait when the connect timeout is 0, in seconds. */
  unboundedWaitSeconds: number;
  /** The registry record to remove when the helper ends. */
  recordFile: string;
  /** The user's runtime folder, which holds the askpass socket and the folder of the launcher. */
  runtimeFolder: string;
  /** The editor's executable, which runs the askpass program. */
  runtime: string;
  /** The bundled askpass program. */
  askpassProgram: string;
  /** The host as the user named it, for the texts of the questions. */
  displayHost: string;
  /** Whether the user's own askpass applies: then ours sets nothing. */
  externalAskpass: boolean;
  /** How long an askpass connection may take to send its question, in milliseconds. */
  askpassFirstMessageMilliseconds: number;
}

/** The ports a helper runs on: the real ones in the helper process, fakes in tests. */
export interface ConnectionHelperEnvironment {
  parameters: HelperParameters;
  port: EndpointPort;
  clock: () => number;
  scheduler: Scheduler;
  files: RegistryFilePort;
  launcherFiles: LauncherFiles;
  /** A new secret for the askpass endpoint, unguessable and different on every call. */
  newNonce: () => string;
  spawner: ProcessSpawner;
  editorEnvironment: Readonly<Record<string, string | undefined>>;
  helloLimitMilliseconds: number;
  logLine: (line: string) => void;
}

/** Serves until the policy or a stop ends the helper; the record is removed whichever way it ends. */
export async function runConnectionHelper(
  environment: ConnectionHelperEnvironment,
): Promise<ServeEnd> {
  const {parameters} = environment;
  // The client wrote these start values from a ConnectionHelperOptions.
  const options = parameters.options as unknown as ConnectionHelperOptions;
  try {
    const request = JSON.parse(options.request) as SshRequest;
    const askpassNonce = environment.newNonce();
    const askpassSocket = askpassEndpointPath(
      options.runtimeFolder,
      parameters.endpoint,
      askpassNonce,
    );
    const launcher = await installLauncher(
      environment.launcherFiles,
      options.runtimeFolder,
      options.runtime,
      options.askpassProgram,
    );
    const handler = new ConnectionHandler({
      invocation: buildInvocation({
        ...request,
        forwards: [{kind: 'dynamic', localPort: options.socksPort}],
      }),
      socksPort: options.socksPort,
      spawner: environment.spawner,
      askpassEnvironment: askpassEnvironment({
        launcher,
        endpoint: askpassSocket,
        nonce: askpassNonce,
        external: options.externalAskpass,
      }),
      editorEnvironment: environment.editorEnvironment,
      waitSettings: {
        connectTimeoutSeconds: Number(
          request.effective.connectTimeout ?? request.settings.connectTimeout,
        ),
        unboundedWaitSeconds: options.unboundedWaitSeconds,
      },
      scheduler: environment.scheduler,
      askpass: {
        nonce: askpassNonce,
        displayHost: options.displayHost,
        firstMessageMilliseconds: options.askpassFirstMessageMilliseconds,
      },
      logLine: environment.logLine,
    });
    const askpassServer = await environment.port.listen(
      askpassSocket,
      connection => {
        handler.acceptAskpass(connection);
      },
    );
    try {
      return await serve({
        endpoint: parameters.endpoint,
        nonce: parameters.nonce,
        payload: parameters.payload,
        policy: parameters.policy,
        handler,
        port: environment.port,
        clock: environment.clock,
        scheduler: environment.scheduler,
        helloLimitMilliseconds: environment.helloLimitMilliseconds,
        logLine: environment.logLine,
      });
    } finally {
      handler.close();
      await askpassServer.close();
    }
  } finally {
    await environment.files.remove(options.recordFile);
  }
}
