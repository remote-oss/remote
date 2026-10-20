/**
 * @fileoverview A starter for the process test: it acquires the echo helper through the launcher, so the helper
 * leaves its process tree, prints the outcome's kind and waits to be killed. Its arguments are the registry folder
 * and the endpoint folder.
 */

import path from 'node:path';
import {acquire, nodeClientEnvironment} from '../../src/index.ts';

const [registryFolder = '', endpointFolder = ''] = process.argv.slice(2);

void acquire(
  {
    ...nodeClientEnvironment(process.execPath, {
      helloLimitMilliseconds: 2000,
      startLimitMilliseconds: 10000,
      retryMilliseconds: 100,
    }),
    endpointFolder,
  },
  {
    folder: registryFolder,
    namespace: 'test.echo',
    helperKey: 'tree',
    script: path.join(import.meta.dirname, 'echo-helper.ts'),
    policy: {kind: 'graceAfterLastLease', milliseconds: 60000},
    prepare: () =>
      Promise.resolve({kind: 'ready', options: {}, payload: {kind: 'echo'}}),
    cancellation: new AbortController().signal,
    leaveStarterTree: true,
    launcherScript: path.join(import.meta.dirname, 'helper-launcher.ts'),
  },
).then(outcome => {
  console.log(outcome.kind);
  setInterval(() => undefined, 1000);
});
