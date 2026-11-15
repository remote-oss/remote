/**
 * @fileoverview A measurement for card #2678, on its proof branch only: the session loop that a Windows host's shared
 * session starts, run over plain `ssh` to `winhost` with empty and with one-run input, so the loop's start on a real
 * Windows host is seen apart from the extension's connect.
 */

import {spawnSync} from 'node:child_process';
import {
  powershellCommandsFor,
  powershellSessionStart,
} from '../../../packages/lib-ssh/src/connection-server/powershell-session.ts';
import {variable} from '../windows/harness.ts';

/** Runs the loop on the host with `input` on its standard input, and prints what came back and how long it took. */
function measureLoop(label: string, input: string): void {
  const {remoteProgram} = powershellSessionStart();
  const started = Date.now();
  const result = spawnSync(
    'ssh',
    ['-F', variable('HARNESS_SSH_CONFIG'), 'winhost', remoteProgram],
    {input, encoding: 'utf8', timeout: 120_000},
  );
  console.log(
    `c2678-loop-direct ${label}: ${JSON.stringify({
      status: result.status,
      signal: result.signal,
      milliseconds: Date.now() - started,
      commandLength: remoteProgram.length,
      stdout: result.stdout.slice(0, 800),
      stderr: result.stderr.slice(0, 1500),
    })}`,
  );
}

describe('the Windows session loop over plain ssh (card #2678, measurement)', function () {
  this.timeout(300_000);

  it('measure: the loop with empty input', () => {
    measureLoop('empty', '');
  });

  it('measure: the loop with one run that prints its platform', () => {
    measureLoop(
      'one-run',
      powershellCommandsFor('c2678mark', {
        script: 'Write-Output "platform: $([Environment]::OSVersion.Platform)"',
        environment: {},
        inputBase64: null,
      }),
    );
  });
});
