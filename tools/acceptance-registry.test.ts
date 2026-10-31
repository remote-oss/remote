/**
 * @fileoverview The run's registry against a recording command runner and a fake clock.
 */

import {deepStrictEqual, ok, rejects} from 'node:assert';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {
  ensureRunRegistry,
  REGISTRY_IMAGE,
  REGISTRY_LABEL,
  type RegistryClock,
  SYSTEM_CLOCK,
  startRunRegistry,
} from './acceptance-registry.ts';
import {DEVCONTAINER_LABEL, RUN_LABEL} from './acceptance-run.ts';
import type {CommandResult, CommandRunner} from './command-runner.ts';

const RUN_ID = '77-2';

/**
 * A runner that records each call and answers `docker run` with a container id, `docker port` with a port line, and
 * `docker ps` with `running` for the running registries and `existing` for all of them.
 */
function recording(
  portLine = '127.0.0.1:49200\n',
  registries: {running: string; existing: string} = {
    running: 'registry-container\n',
    existing: 'registry-container\n',
  },
): {
  command: CommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  function command(
    program: string,
    programArguments: readonly string[],
  ): CommandResult {
    calls.push([program, ...programArguments]);
    const listing = programArguments.includes('--all')
      ? registries.existing
      : registries.running;
    return {
      status: 0,
      stdout:
        programArguments[0] === 'run'
          ? 'registry-container\n'
          : programArguments[0] === 'port'
            ? portLine
            : programArguments[0] === 'ps'
              ? listing
              : '',
      stderr: '',
    };
  }
  return {command, calls};
}

/** A clock whose asks are answered from `statuses` in turn, and that runs as fast as the test. */
function clockOf(statuses: ReadonlyArray<number | undefined>): {
  clock: RegistryClock;
  asked: string[];
} {
  const asked: string[] = [];
  let time = 0;
  const clock: RegistryClock = {
    status: url => {
      asked.push(url);
      return Promise.resolve(statuses[asked.length - 1]);
    },
    now: () => time,
    sleep: milliseconds => {
      time += milliseconds;
      return Promise.resolve();
    },
  };
  return {clock, asked};
}

describe('the run’s registry (card containers-59)', () => {
  it('starts the pinned image on a loopback port, labelled with the run, as a dev container’s and as the registry', async () => {
    const {command, calls} = recording();
    await startRunRegistry(command, clockOf([200]).clock, RUN_ID);
    deepStrictEqual(calls[0], [
      'docker',
      'run',
      '--detach',
      '--label',
      `${RUN_LABEL}=${RUN_ID}`,
      '--label',
      `${DEVCONTAINER_LABEL}=1`,
      '--label',
      `${REGISTRY_LABEL}=1`,
      '--publish',
      '127.0.0.1::5000',
      REGISTRY_IMAGE,
    ]);
  });

  it('pins the image by tag and by the digest of its index', () => {
    deepStrictEqual(
      /^registry:2\.8\.3@sha256:[0-9a-f]{64}$/.test(REGISTRY_IMAGE),
      true,
    );
  });

  it('reads the published port, waits until /v2/ answers 200, and gives the address', async () => {
    const {command, calls} = recording();
    const {clock, asked} = clockOf([undefined, 503, 200]);
    const registry = await startRunRegistry(command, clock, RUN_ID);
    deepStrictEqual(
      [registry.address, calls[1], asked.length, asked[0]],
      [
        '127.0.0.1:49200',
        ['docker', 'port', 'registry-container', '5000/tcp'],
        3,
        'http://127.0.0.1:49200/v2/',
      ],
    );
  });

  it('removes every registry container of the run with its anonymous volume when it is stopped', async () => {
    const {command, calls} = recording();
    const registry = await startRunRegistry(
      command,
      clockOf([200]).clock,
      RUN_ID,
    );
    await registry.stop();
    deepStrictEqual(calls.at(-1), [
      'docker',
      'rm',
      '--force',
      '--volumes',
      'registry-container',
    ]);
  });

  it('tooling-74: stopping the registry after the rows emptied the daemon removes nothing and does not fail', async () => {
    const {command, calls} = recording('127.0.0.1:49200\n', {
      running: '',
      existing: '',
    });
    const registry = await startRunRegistry(
      command,
      clockOf([200]).clock,
      RUN_ID,
    );
    const before = calls.length;
    await registry.stop();
    deepStrictEqual(
      calls.slice(before).filter(call => call[1] === 'rm'),
      [],
    );
  });

  it('fails naming the registry when /v2/ never answers, and removes the container', async () => {
    const {command, calls} = recording();
    const failure = await startRunRegistry(
      command,
      clockOf([]).clock,
      RUN_ID,
    ).then(
      () => 'started',
      (caught: unknown) => String(caught),
    );
    deepStrictEqual(
      [failure, calls.at(-1)?.slice(0, 4)],
      [
        "Error: the run's registry at 127.0.0.1:49200 did not answer GET /v2/ within 30 s",
        ['docker', 'rm', '--force', '--volumes'],
      ],
    );
  });

  it('tooling-57: a registry that runs is left as it is', async () => {
    const {command, calls} = recording();
    const outcome = await ensureRunRegistry(
      command,
      clockOf([]).clock,
      RUN_ID,
      '127.0.0.1:49200',
    );
    deepStrictEqual(
      [outcome, calls.some(call => call[1] === 'run')],
      ['running', false],
    );
  });

  it('tooling-57: a registry a clean-up removed is started again on the same port and waited for', async () => {
    const {command, calls} = recording('127.0.0.1:49200\n', {
      running: '',
      existing: '',
    });
    const {clock, asked} = clockOf([undefined, 200]);
    const outcome = await ensureRunRegistry(
      command,
      clock,
      RUN_ID,
      '127.0.0.1:49200',
    );
    deepStrictEqual(
      [outcome, calls.find(call => call[1] === 'run')?.slice(-2), asked.length],
      ['restarted', ['127.0.0.1:49200:5000', REGISTRY_IMAGE], 2],
    );
  });

  it('tooling-57: a stopped registry container is removed before the new one starts', async () => {
    const {command, calls} = recording('127.0.0.1:49200\n', {
      running: '',
      existing: 'stopped-registry\n',
    });
    await ensureRunRegistry(
      command,
      clockOf([200]).clock,
      RUN_ID,
      '127.0.0.1:49200',
    );
    const removed = calls.findIndex(
      call => call[1] === 'rm' && call.includes('stopped-registry'),
    );
    const started = calls.findIndex(call => call[1] === 'run');
    deepStrictEqual([removed >= 0, removed < started], [true, true]);
  });

  it('fails when the container publishes no port', async () => {
    const {command} = recording('');
    await rejects(
      startRunRegistry(command, clockOf([200]).clock, RUN_ID),
      /publishes no port/,
    );
  });

  it('reads the status of a server that answers, and none from an address nobody listens on', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200).end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    const answered = await SYSTEM_CLOCK.status(
      `http://127.0.0.1:${String(port)}/v2/`,
    );
    await new Promise(resolve => server.close(resolve));
    const closed = await SYSTEM_CLOCK.status(
      `http://127.0.0.1:${String(port)}/v2/`,
    );
    deepStrictEqual([answered, closed], [200, undefined]);
  });

  it('tells the system time and sleeps for the milliseconds it is given', async () => {
    const before = SYSTEM_CLOCK.now();
    await SYSTEM_CLOCK.sleep(20);
    ok(SYSTEM_CLOCK.now() - before >= 15);
  });
});
