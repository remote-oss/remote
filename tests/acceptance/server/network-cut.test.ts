import {deepStrictEqual} from 'node:assert';
import {type ChildProcess, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {runCommand} from '../../../tools/acceptance-run.ts';
import {cutNetwork, restoreNetwork} from '../../../tools/acceptance-network.ts';
import {type RunningHost, startHost} from './host-fixture.ts';

describe('D-85 the host network cut and restored', function () {
  this.timeout(120000);
  let host: RunningHost;
  let session: ChildProcess | undefined;

  before(async () => {
    host = await startHost();
  });

  afterEach(() => {
    session?.kill();
    session = undefined;
    restoreNetwork(runCommand, host.container);
  });

  after(() => {
    host.stop();
  });

  /** An `ssh` run to the host with these options before its host name. */
  function sshArguments(...options: string[]): string[] {
    return [
      '-F',
      path.join(host.runFolder, 'ssh_config'),
      ...options,
      'harness',
    ];
  }

  it('D-85: a session open across the cut gets no reset', async () => {
    const errors: string[] = [];
    session = spawn(
      'ssh',
      [...sshArguments('-o', 'ServerAliveInterval=0'), 'cat'],
      {
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    );
    session.stderr?.on('data', (chunk: Buffer) => {
      errors.push(chunk.toString('utf8'));
    });
    await delay(1000);
    cutNetwork(runCommand, host.container);
    session.stdin?.write('after the cut\n');
    await delay(5000);
    deepStrictEqual([session.exitCode, errors], [null, []]);
  });

  it('D-85: a new connection during the cut gets no answer', () => {
    cutNetwork(runCommand, host.container);
    const result = runCommand('ssh', [
      ...sshArguments('-o', 'ConnectTimeout=3'),
      'true',
    ]);
    deepStrictEqual(
      [result.status, result.stderr.includes('timed out')],
      [255, true],
    );
  });

  it('D-85: after the restore a new connection works on the same port', () => {
    cutNetwork(runCommand, host.container);
    restoreNetwork(runCommand, host.container);
    deepStrictEqual(runCommand('ssh', [...sshArguments(), 'true']).status, 0);
  });

  it('D-85: cutting twice and restoring twice is harmless', () => {
    cutNetwork(runCommand, host.container);
    cutNetwork(runCommand, host.container);
    restoreNetwork(runCommand, host.container);
    restoreNetwork(runCommand, host.container);
    deepStrictEqual(runCommand('ssh', [...sshArguments(), 'true']).status, 0);
  });
});
