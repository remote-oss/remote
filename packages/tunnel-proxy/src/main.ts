/**
 * @fileoverview The local proxy program: lib-helper's helper, started by a Remote - Tunnels window with the relay's
 * domain and its data socket's path in its start values, serving every window of the profile until its end policy
 * ends it. Its record and its data socket go with it.
 */

import {
  helperParameters,
  nodeEndpointPort,
  nodeFilePort,
  nodeTimer,
  removeOwnRecord,
  serve,
} from 'lib-helper';
import manifest from '../package.json' with {type: 'json'};
import {DataSocket} from './data-socket.ts';
import {ProxyHandler} from './handler.ts';
import {sdkLegs} from './sdk.ts';

/** How long a connection to the proxy may take to say hello, in milliseconds. */
const HELLO_LIMIT_MILLISECONDS = 2000;

/** Writes a line to the error stream, which the window's log reads. */
function logLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function main(): Promise<void> {
  const parameters = helperParameters(process.env);
  const {domain, dataSocket} = parameters.options;
  const socket = await DataSocket.listen(String(dataSocket), process.platform);
  try {
    await serve({
      endpoint: parameters.endpoint,
      nonce: parameters.nonce,
      recordFile: parameters.recordFile,
      files: nodeFilePort,
      payload: {...parameters.payload, helperProcessId: process.pid},
      policy: parameters.policy,
      handler: new ProxyHandler(
        sdkLegs(String(domain), manifest.version),
        socket,
      ),
      port: nodeEndpointPort(process.platform),
      clock: Date.now,
      scheduler: {setTimer: nodeTimer},
      helloLimitMilliseconds: HELLO_LIMIT_MILLISECONDS,
      logLine,
    });
  } finally {
    await socket.close();
    await removeOwnRecord(
      nodeFilePort,
      parameters.recordFile,
      parameters.nonce,
    );
  }
}

main().catch((caught: unknown) => {
  logLine(
    `the local proxy stopped: ${caught instanceof Error ? caught.message : String(caught)}`,
  );
  process.exitCode = 1;
});
