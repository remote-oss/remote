/**
 * @fileoverview A host channel over a real shell on the fake host: the lifecycle runs the generated scripts for real,
 * so what the tests prove is the whole path from the request to the parsed result.
 */

import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import type {
  CopyOutcome,
  HostChannel,
  PlatformHint,
  ScriptOutcome,
  ScriptRequest,
} from 'lib-host';
import type {FakeHost} from './fake-host.ts';

/** A channel whose scripts run under `/bin/sh` with the fake host's environment; nothing can be copied. */
export function shellChannel(
  host: FakeHost,
  hint: PlatformHint = 'linux',
): HostChannel {
  return {
    runScript(
      request: ScriptRequest,
      onLine: (line: string) => void,
    ): Promise<ScriptOutcome> {
      return new Promise<ScriptOutcome>(resolve => {
        const child = spawn('/bin/sh', ['-c', request.script], {
          env: {...host.environment, ...request.environment},
        });
        const bytes =
          request.input.kind === 'file'
            ? readFileSync(request.input.localFile)
            : Buffer.from(request.input.text);
        let pending = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          const lines = (pending + chunk).split('\n');
          pending = lines.pop() ?? '';
          lines.forEach(onLine);
        });
        child.once('close', status => {
          if (pending !== '') {
            onLine(pending);
          }
          resolve({kind: 'exited', status: status ?? 1});
        });
        request.cancellation.addEventListener('abort', () => {
          child.kill();
        });
        child.stdin.on('error', () => undefined);
        child.stdin.end(bytes);
      });
    },
    copyToHost(): Promise<CopyOutcome> {
      return Promise.resolve({
        kind: 'failed',
        failure: {
          kind: 'copyFailed',
          detail: 'the shell channel copies nothing',
        },
      });
    },
    identity: () => 'fake-host',
    platformHint: () => hint,
  };
}
