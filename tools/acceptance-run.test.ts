/**
 * @fileoverview The run identity, the shared start of the SSH host and the clean-up (card tooling-10), against a
 * fake CommandRunner that records each call and answers from a script.
 */

import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  acceptanceRunId,
  checked,
  cleanRun,
  type CommandResult,
  type CommandRunner,
  hostImageOf,
  type HostContainer,
  RUN_LABEL,
  startHostContainer,
} from './acceptance-run.ts';

const RUN_ID = '77-2';

/** The command arguments of one recorded call. */
interface RecordedCall {
  program: string;
  argv: string[];
}

/** A scripted CommandRunner: it records each call and answers from a list of results, one per call. */
interface ScriptedCommands {
  readonly calls: RecordedCall[];
  /** Queues a successful answer with the given standard output. */
  passes(stdout?: string): void;
  /** Queues a failed answer with the given status and standard error. */
  fails(status: number, stderr: string): void;
  /** The arguments of the calls made to one program, in order. */
  callsOf(program: string): string[][];
}

/** Makes the scripted runner; a call past the script is a bug in the test. */
function scriptedCommands(): ScriptedCommands & CommandRunner {
  const calls: RecordedCall[] = [];
  const script: CommandResult[] = [];

  function command(program: string, argv: readonly string[]): CommandResult {
    calls.push({program, argv: [...argv]});
    if (program === 'ssh-keygen') {
      // The real ssh-keygen writes the key's public part next to the key named by -f.
      const target = argv.indexOf('-f');
      const keyFile = target !== -1 ? argv[target + 1] : undefined;
      if (keyFile !== undefined) {
        writeFileSync(`${keyFile}.pub`, 'ssh-ed25519 AAAA acceptance\n');
      }
    }
    const answer = script.shift();
    if (answer === undefined) {
      throw new Error(`no scripted answer for ${program} ${argv.join(' ')}`);
    }
    return answer;
  }

  function passes(stdout = ''): void {
    script.push({status: 0, stdout, stderr: ''});
  }

  function fails(status: number, stderr: string): void {
    script.push({status, stdout: '', stderr});
  }

  function callsOf(program: string): string[][] {
    return calls
      .filter(call => call.program === program)
      .map(call => call.argv);
  }

  return Object.assign(command, {calls, passes, fails, callsOf});
}

describe('acceptanceRunId (card tooling-10)', () => {
  it('gives GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT while both are set', () => {
    strictEqual(
      acceptanceRunId({GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2'}, 1),
      '77-2',
    );
  });

  it('gives local-<process id> without the GitHub variables', () => {
    strictEqual(acceptanceRunId({}, 4242), 'local-4242');
  });

  it('gives local-<process id> when the attempt is empty', () => {
    strictEqual(
      acceptanceRunId({GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: ''}, 4242),
      'local-4242',
    );
  });

  it('gives local-<process id> when the run id is empty', () => {
    strictEqual(
      acceptanceRunId({GITHUB_RUN_ID: '', GITHUB_RUN_ATTEMPT: '2'}, 4242),
      'local-4242',
    );
  });

  it('gives local-<process id> when the attempt is absent', () => {
    strictEqual(acceptanceRunId({GITHUB_RUN_ID: '77'}, 4242), 'local-4242');
  });
});

describe('hostImageOf (card tooling-10)', () => {
  it('tags the shared host image with the run id', () => {
    strictEqual(hostImageOf('77-2'), 'remote-oss-acceptance-host:77-2');
  });
});

describe('checked (card tooling-10)', () => {
  it('throws naming the program, its arguments, the status and the standard error', () => {
    const scripted = scriptedCommands();
    scripted.fails(1, 'bad');
    let message = '';
    try {
      checked(scripted, 'ssh-keygen', ['-t', 'ed25519']);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    deepStrictEqual(
      {message, calls: scripted.calls},
      {
        message: 'ssh-keygen -t ed25519 failed (1): bad',
        calls: [{program: 'ssh-keygen', argv: ['-t', 'ed25519']}],
      },
    );
  });
});

describe('startHostContainer (card tooling-10)', () => {
  it("builds the run's image, makes the run's key and runs the labelled container", () => {
    const runFolder = mkdtempSync(path.join(tmpdir(), 'acceptance-run-'));
    try {
      const scripted = scriptedCommands();
      scripted.passes(); // docker build
      scripted.passes(); // ssh-keygen
      scripted.passes('c123\n'); // docker run
      scripted.passes('127.0.0.1:49153\n'); // docker port

      const host: HostContainer = startHostContainer(
        scripted,
        '/root',
        RUN_ID,
        runFolder,
      );

      deepStrictEqual(
        {
          host,
          build: scripted.callsOf('docker').filter(argv => argv[0] === 'build'),
          runCall: scripted.callsOf('docker').filter(argv => argv[0] === 'run'),
        },
        {
          host: {
            container: 'c123',
            port: 49153,
            keyFile: path.join(runFolder, 'id_ed25519'),
          },
          build: [
            [
              'build',
              '--load',
              '--quiet',
              '--tag',
              'remote-oss-acceptance-host:77-2',
              path.join('/root', 'tests', 'acceptance', 'host'),
            ],
          ],
          runCall: [
            [
              'run',
              '--detach',
              '--rm',
              '--label',
              'remote-oss.acceptance.run=77-2',
              '--env',
              'AUTHORIZED_KEY=ssh-ed25519 AAAA acceptance',
              '--publish',
              '127.0.0.1::22',
              'remote-oss-acceptance-host:77-2',
            ],
          ],
        },
      );
    } finally {
      rmSync(runFolder, {recursive: true, force: true});
    }
  });
});

describe('cleanRun (card tooling-10)', () => {
  it("removes the run's containers by label and its image tag, then proves nothing is left", () => {
    const scripted = scriptedCommands();
    scripted.passes('c1\nc2\n'); // docker ps, the first listing
    scripted.passes(); // docker rm --force c1
    scripted.passes(); // docker rm --force c2
    scripted.passes(); // docker image rm --force
    scripted.passes(''); // docker ps, the second listing

    cleanRun(scripted, RUN_ID);

    deepStrictEqual(scripted.calls, [
      {
        program: 'docker',
        argv: [
          'ps',
          '--all',
          '--quiet',
          '--filter',
          'label=remote-oss.acceptance.run=77-2',
        ],
      },
      {program: 'docker', argv: ['rm', '--force', 'c1']},
      {program: 'docker', argv: ['rm', '--force', 'c2']},
      {
        program: 'docker',
        argv: ['image', 'rm', '--force', 'remote-oss-acceptance-host:77-2'],
      },
      {
        program: 'docker',
        argv: [
          'ps',
          '--all',
          '--quiet',
          '--filter',
          'label=remote-oss.acceptance.run=77-2',
        ],
      },
    ]);
  });

  it('does not throw when the image is already gone', () => {
    const scripted = scriptedCommands();
    scripted.passes(''); // docker ps
    scripted.fails(1, 'No such image'); // docker image rm --force
    scripted.passes(''); // docker ps

    cleanRun(scripted, RUN_ID);

    strictEqual(scripted.calls.length, 3);
  });

  it("throws naming the container when one still carries the run's label", () => {
    const scripted = scriptedCommands();
    scripted.passes(''); // docker ps
    scripted.passes(); // docker image rm --force
    scripted.passes('c9\n'); // docker ps, the second listing

    throws(
      () => {
        cleanRun(scripted, RUN_ID);
      },
      {message: 'the run 77-2 still owns containers after the clean-up: c9'},
    );
  });

  it("prunes nothing and filters every listing by the run's label alone", () => {
    const scripted = scriptedCommands();
    scripted.passes('c1\n'); // docker ps
    scripted.passes(); // docker rm --force c1
    scripted.passes(); // docker image rm --force
    scripted.passes(''); // docker ps

    cleanRun(scripted, RUN_ID);

    deepStrictEqual(
      {
        prunesNothing: scripted.calls.every(
          call =>
            !call.program.includes('prune') &&
            !call.argv.some(argValue => argValue.includes('prune')),
        ),
        listings: scripted.calls
          .filter(call => call.program === 'docker' && call.argv[0] === 'ps')
          .map(call => call.argv),
      },
      {
        prunesNothing: true,
        listings: [
          [
            'ps',
            '--all',
            '--quiet',
            '--filter',
            `label=${RUN_LABEL}=${RUN_ID}`,
          ],
          [
            'ps',
            '--all',
            '--quiet',
            '--filter',
            `label=${RUN_LABEL}=${RUN_ID}`,
          ],
        ],
      },
    );
  });
});
