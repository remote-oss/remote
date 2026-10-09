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
}

/** The ports a helper runs on: the real ones in the helper process, fakes in tests. */
export interface ConnectionHelperEnvironment {
  parameters: HelperParameters;
  port: EndpointPort;
  clock: () => number;
  scheduler: Scheduler;
  files: RegistryFilePort;
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
  const request = JSON.parse(options.request) as SshRequest;
  const handler = new ConnectionHandler({
    invocation: buildInvocation({
      ...request,
      forwards: [{kind: 'dynamic', localPort: options.socksPort}],
    }),
    socksPort: options.socksPort,
    spawner: environment.spawner,
    askpassEnvironment: {},
    editorEnvironment: environment.editorEnvironment,
    waitSettings: {
      connectTimeoutSeconds: Number(
        request.effective.connectTimeout ?? request.settings.connectTimeout,
      ),
      unboundedWaitSeconds: options.unboundedWaitSeconds,
    },
    scheduler: environment.scheduler,
    logLine: environment.logLine,
  });
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
    await environment.files.remove(options.recordFile);
  }
}
