/**
 * @fileoverview The run's registry against a recording command runner and a fake clock.
 */

import {deepStrictEqual, rejects} from 'node:assert';
import {
  REGISTRY_IMAGE,
  type RegistryClock,
  startRunRegistry,
} from './acceptance-registry.ts';
import {DEVCONTAINER_LABEL, RUN_LABEL} from './acceptance-run.ts';
import type {CommandResult, CommandRunner} from './command-runner.ts';

const RUN_ID = '77-2';

/** A runner that records each call and answers `docker run` with a container id and `docker port` with a port line. */
function recording(): {command: CommandRunner; calls: string[][]} {
  const calls: string[][] = [];
  function command(
    program: string,
    programArguments: readonly string[],
  ): CommandResult {
    calls.push([program, ...programArguments]);
    return {
      status: 0,
      stdout:
        programArguments[0] === 'run'
          ? 'registry-container\n'
          : programArguments[0] === 'port'
            ? '127.0.0.1:49200\n'
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
  it('starts the pinned image on a loopback port, labelled with the run and as a dev container’s', async () => {
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

  it('removes the container with its anonymous volume when it is stopped', async () => {
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

  it('fails when the container publishes no port', async () => {
    const calls: string[][] = [];
    function command(
      program: string,
      programArguments: readonly string[],
    ): CommandResult {
      calls.push([program, ...programArguments]);
      return {
        status: 0,
        stdout: programArguments[0] === 'run' ? 'registry-container\n' : '',
        stderr: '',
      };
    }
    await rejects(
      startRunRegistry(command, clockOf([200]).clock, RUN_ID),
      /publishes no port/,
    );
  });
});
