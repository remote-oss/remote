/**
 * @fileoverview The start of a helper script: it reads the parameters its client passed in the environment and
 * serves with the consumer's handler on Node.js's sockets and timers.
 */

import {PARAMETERS_VARIABLE, type HelperParameters} from '../client/spawn.ts';
import {nodeTimer} from '../client/node-environment.ts';
import {nodeEndpointPort} from '../endpoint/node-endpoint.ts';
import {nodeFilePort} from '../registry/node-file-port.ts';
import {type MessageHandler, serve, type ServeEnd} from './serve.ts';

/** How long a connection may take to say hello. */
const HELLO_LIMIT = 2000;

/** The parameters of this helper; throws when the variable is missing or not JSON. */
export function helperParameters(
  environment: Readonly<Record<string, string | undefined>>,
): HelperParameters {
  const text = environment[PARAMETERS_VARIABLE];
  if (text === undefined) {
    throw new Error(`${PARAMETERS_VARIABLE} is not set`);
  }
  // The client wrote this value from a HelperParameters.
  return JSON.parse(text) as HelperParameters;
}

/**
 * The environment this helper passes on to the programs it starts: the one it was started with, without the
 * variable that carries its own parameters, which hold the nonce and the whole request.
 */
export function inheritedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => name !== PARAMETERS_VARIABLE,
    ),
  );
}

/** Serves this helper until its policy or a stop ends it. */
export function runHelper(
  handler: MessageHandler,
  logLine: (line: string) => void,
): Promise<ServeEnd> {
  const parameters = helperParameters(process.env);
  return serve({
    endpoint: parameters.endpoint,
    nonce: parameters.nonce,
    recordFile: parameters.recordFile,
    files: nodeFilePort,
    payload: parameters.payload,
    policy: parameters.policy,
    handler,
    port: nodeEndpointPort(),
    clock: Date.now,
    scheduler: {setTimer: nodeTimer},
    helloLimitMilliseconds: HELLO_LIMIT,
    logLine,
  });
}
