import {deepStrictEqual, strictEqual} from 'node:assert';
import {type ChildProcess, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {runCommand} from '../../../tools/command-runner.ts';
import {
  cutNetwork,
  cutRoute,
  restoreNetwork,
  restoreRoute,
  type RouteCut,
} from '../../../tools/acceptance-network.ts';
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

  /** The status of a new connection that waits 3 s for the host; 255 and `timed out` when the host does not answer. */
  function newConnection() {
    const result = runCommand('ssh', [
      ...sshArguments('-o', 'ConnectTimeout=3'),
      'true',
    ]);
    return {
      status: result.status,
      timedOut: result.stderr.includes('timed out'),
    };
  }

  it('D-85: a session open across the cut gets no reset and no echo', async () => {
    const errors: string[] = [];
    const echoed: string[] = [];
    session = spawn(
      'ssh',
      [...sshArguments('-o', 'ServerAliveInterval=0'), 'cat'],
      {stdio: ['pipe', 'pipe', 'pipe']},
    );
    session.stdout?.on('data', (chunk: Buffer) => {
      echoed.push(chunk.toString('utf8'));
    });
    session.stderr?.on('data', (chunk: Buffer) => {
      errors.push(chunk.toString('utf8'));
    });
    await delay(1000);
    cutNetwork(runCommand, host.container);
    session.stdin?.write('after the cut\n');
    await delay(5000);
    deepStrictEqual([session.exitCode, errors, echoed], [null, [], []]);
  });

  it('D-85: a new connection during the cut gets no answer', () => {
    cutNetwork(runCommand, host.container);
    deepStrictEqual(newConnection(), {status: 255, timedOut: true});
  });

  it('D-85: after the restore a new connection works on the same port', () => {
    cutNetwork(runCommand, host.container);
    const during = newConnection();
    restoreNetwork(runCommand, host.container);
    deepStrictEqual(
      [during, runCommand('ssh', [...sshArguments(), 'true']).status],
      [{status: 255, timedOut: true}, 0],
    );
  });

  it('D-85: cutting twice and restoring twice is harmless', () => {
    cutNetwork(runCommand, host.container);
    cutNetwork(runCommand, host.container);
    const during = newConnection();
    restoreNetwork(runCommand, host.container);
    restoreNetwork(runCommand, host.container);
    deepStrictEqual(
      [during, runCommand('ssh', [...sshArguments(), 'true']).status],
      [{status: 255, timedOut: true}, 0],
    );
  });
});

describe("the route to the host's own address (card tooling-47)", function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
  });

  afterEach(() => {
    restoreRoute(runCommand, host.container, host.routedAddress);
  });

  after(() => {
    host.stop();
  });

  /** An `ssh` run to the alias with these options, as a command that succeeds; how long it took, in milliseconds. */
  function connecting(alias: string, ...options: string[]) {
    const config = path.join(host.runFolder, 'ssh_config');
    const started = Date.now();
    const result = runCommand('ssh', ['-F', config, ...options, alias, 'true']);
    return {
      status: result.status,
      lines: result.stderr.split('\n').map(line => line.trim()),
      seconds: (Date.now() - started) / 1000,
    };
  }

  function cut(cutKind: RouteCut): void {
    cutRoute(runCommand, host.container, host.routedAddress, cutKind);
  }

  it('tooling-47: the routed alias connects', () => {
    strictEqual(connecting('routed').status, 0);
  });

  it("tooling-47: an unreachable route gives ssh's No route to host", () => {
    cut('unreachable');
    const result = connecting('routed');
    deepStrictEqual(
      [
        result.status,
        result.lines.includes(
          `ssh: connect to host ${host.routedAddress} port 22: No route to host`,
        ),
      ],
      [255, true],
    );
  });

  it('tooling-47: a silent route times the connect out', () => {
    cut('silent');
    const result = connecting('routed', '-o', 'ConnectTimeout=5');
    deepStrictEqual(
      [
        result.status,
        result.lines.includes(
          `ssh: connect to host ${host.routedAddress} port 22: Connection timed out`,
        ),
        result.seconds >= 4 && result.seconds <= 9,
      ],
      [255, true, true],
    );
  });

  for (const kind of ['unreachable', 'silent'] as const) {
    it(`tooling-47: the route cut as ${kind} leaves the published port working`, () => {
      cut(kind);
      strictEqual(connecting('harness').status, 0);
    });
  }

  it('tooling-47: after restoreRoute the routed alias connects again', () => {
    cut('unreachable');
    const during = connecting('routed').status;
    restoreRoute(runCommand, host.container, host.routedAddress);
    deepStrictEqual([during, connecting('routed').status], [255, 0]);
  });
});
