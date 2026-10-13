/**
 * @fileoverview The run identity, the shared start of the SSH host and the clean-up (card tooling-10), against a
 * fake CommandRunner that records each call and answers from a script.
 */

import {
  deepStrictEqual,
  notStrictEqual,
  strictEqual,
  throws,
} from 'node:assert';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  newPassword,
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
  it('gives the run id, the attempt and the job in CI', () => {
    strictEqual(
      acceptanceRunId(
        {
          GITHUB_RUN_ID: '77',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_JOB: 'acceptance-server',
        },
        1,
      ),
      '77-2-acceptance-server',
    );
  });

  it('gives different ids for two jobs of one run', () => {
    notStrictEqual(
      acceptanceRunId(
        {
          GITHUB_RUN_ID: '77',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_JOB: 'acceptance-slice-1',
        },
        1,
      ),
      acceptanceRunId(
        {
          GITHUB_RUN_ID: '77',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_JOB: 'acceptance-server',
        },
        1,
      ),
    );
  });

  it('gives local-<process id> when the job is empty', () => {
    strictEqual(
      acceptanceRunId(
        {GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: ''},
        4242,
      ),
      'local-4242',
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

  it('gives local-<process id> when the job is absent', () => {
    strictEqual(
      acceptanceRunId({GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2'}, 4242),
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

/** The scripted commands of a successful start: build, key, run, port. */
function startingCommands(): ScriptedCommands & CommandRunner {
  const scripted = scriptedCommands();
  scripted.passes(); // docker build
  scripted.passes(); // ssh-keygen
  scripted.passes('c123\n'); // docker run
  scripted.passes('127.0.0.1:49153\n'); // docker port
  return scripted;
}

describe('startHostContainer (card tooling-10)', () => {
  it('passes the extra arguments to docker run, before the image (card tooling-14)', () => {
    const runFolder = mkdtempSync(path.join(tmpdir(), 'acceptance-run-'));
    try {
      const scripted = startingCommands();
      startHostContainer(scripted, '/root', RUN_ID, runFolder, [
        '--env',
        'HOST_FETCH=curl',
      ]);
      deepStrictEqual(
        scripted
          .callsOf('docker')
          .find(argv => argv[0] === 'run')
          ?.slice(-4),
        [
          '127.0.0.1::22',
          '--env',
          'HOST_FETCH=curl',
          'remote-oss-acceptance-host:77-2',
        ],
      );
    } finally {
      rmSync(runFolder, {recursive: true, force: true});
    }
  });

  it("builds the run's image, makes the run's key and runs the labelled container", () => {
    const runFolder = mkdtempSync(path.join(tmpdir(), 'acceptance-run-'));
    try {
      const scripted = startingCommands();

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
            passwordFile: path.join(runFolder, 'password'),
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
              '--env-file',
              path.join(runFolder, 'host.env'),
              '--cap-add',
              'NET_ADMIN',
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

describe('newPassword (card tooling-17)', () => {
  it('makes 24 letters and digits', () => {
    strictEqual(/^[A-Za-z0-9]{24}$/.test(newPassword()), true);
  });

  it('draws every character from the whole alphabet of 62', () => {
    const limits: number[] = [];
    newPassword(limit => {
      limits.push(limit);
      return limit - 1;
    });
    deepStrictEqual([new Set(limits), limits.length], [new Set([62]), 24]);
  });

  it('maps the draw 0 to A, 25 to Z, 26 to a, 51 to z, 52 to 0 and 61 to 9', () => {
    const draws = [0, 25, 26, 51, 52, 61];
    strictEqual(newPassword(() => draws.shift() ?? 0).slice(0, 6), 'AZaz09');
  });

  it('differs between two calls', () => {
    notStrictEqual(newPassword(), newPassword());
  });
});

describe('the password of the start (card tooling-17)', () => {
  /** Starts a host in a fresh run folder and gives back the folder, the host and the docker run call. */
  function started(): {
    runFolder: string;
    host: HostContainer;
    runCall: string[];
  } {
    const runFolder = mkdtempSync(path.join(tmpdir(), 'acceptance-run-'));
    const scripted = startingCommands();
    const host = startHostContainer(scripted, '/root', RUN_ID, runFolder);
    return {
      runFolder,
      host,
      runCall: scripted.callsOf('docker').find(argv => argv[0] === 'run') ?? [],
    };
  }

  it('is the one line of the env file, HOST_PASSWORD=<password>', () => {
    const {runFolder, host} = started();
    try {
      const password = readFileSync(host.passwordFile, 'utf8');
      strictEqual(
        readFileSync(path.join(runFolder, 'host.env'), 'utf8'),
        `HOST_PASSWORD=${password}\n`,
      );
    } finally {
      rmSync(runFolder, {recursive: true, force: true});
    }
  });

  it('is the bare password, of 24 letters and digits, in the password file', () => {
    const {runFolder, host} = started();
    try {
      strictEqual(
        /^[A-Za-z0-9]{24}$/.test(readFileSync(host.passwordFile, 'utf8')),
        true,
      );
    } finally {
      rmSync(runFolder, {recursive: true, force: true});
    }
  });

  it('is kept in files of mode 600', () => {
    const {runFolder, host} = started();
    try {
      deepStrictEqual(
        [
          statSync(host.passwordFile).mode & 0o777,
          statSync(path.join(runFolder, 'host.env')).mode & 0o777,
        ],
        [0o600, 0o600],
      );
    } finally {
      rmSync(runFolder, {recursive: true, force: true});
    }
  });

  it('never appears in the docker command line', () => {
    const {runFolder, host, runCall} = started();
    try {
      const password = readFileSync(host.passwordFile, 'utf8');
      strictEqual(
        runCall.some(argument => argument.includes(password)),
        false,
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
