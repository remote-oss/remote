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
  buildDevContainerImage,
  cleanRun,
  connectRunNetwork,
  createdSecondsOf,
  hostImageOf,
  type HostContainer,
  NETWORK_AGE_FORMAT,
  newPassword,
  RUN_LABEL,
  runNetworkOf,
  startHostContainer,
  sweepStaleDevContainers,
} from './acceptance-run.ts';
import {
  checked,
  type CommandResult,
  type CommandRunner,
  runCommand,
} from './command-runner.ts';

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
      // The real ssh-keygen writes the key named by -f and its public part next to it.
      const target = argv.indexOf('-f');
      const keyFile = target !== -1 ? argv[target + 1] : undefined;
      if (keyFile !== undefined) {
        writeFileSync(keyFile, 'private\n');
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
              '--progress=plain',
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

describe('the Ubuntu host (card tooling-70)', () => {
  it('builds from host-ubuntu under its own tag, and a second start in the run folder keeps the run key and password', () => {
    const runFolder = mkdtempSync(path.join(tmpdir(), 'acceptance-run-'));
    try {
      const alpine = startHostContainer(
        startingCommands(),
        '/root',
        RUN_ID,
        runFolder,
      );
      const password = readFileSync(alpine.passwordFile, 'utf8');
      const second = scriptedCommands();
      second.passes(); // docker build
      second.passes('c456\n'); // docker run
      second.passes('127.0.0.1:49154\n'); // docker port
      const ubuntu = startHostContainer(
        second,
        '/root',
        RUN_ID,
        runFolder,
        [],
        'ubuntu-26.04',
      );
      deepStrictEqual(
        [
          second
            .callsOf('docker')
            .find(argv => argv[0] === 'build')
            ?.slice(-2),
          second.callsOf('ssh-keygen').length,
          readFileSync(ubuntu.passwordFile, 'utf8') === password,
          second
            .callsOf('docker')
            .find(argv => argv[0] === 'run')
            ?.at(-1),
          [ubuntu.container, ubuntu.port],
        ],
        [
          [
            'remote-oss-acceptance-host:77-2-ubuntu-26.04',
            path.join('/root', 'tests', 'acceptance', 'host-ubuntu'),
          ],
          0,
          true,
          'remote-oss-acceptance-host:77-2-ubuntu-26.04',
          ['c456', 49154],
        ],
      );
    } finally {
      rmSync(runFolder, {recursive: true, force: true});
    }
  });

  it("names Alpine's host image by the run id alone and another base's with the base after it", () => {
    deepStrictEqual(
      [hostImageOf('77-2'), hostImageOf('77-2', 'ubuntu-26.04')],
      [
        'remote-oss-acceptance-host:77-2',
        'remote-oss-acceptance-host:77-2-ubuntu-26.04',
      ],
    );
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

const NETWORK = 'remote-oss-acceptance-77-2';

/** The `docker network inspect` that finds the run's network already there, or not. */
const NETWORKS_OF_ANY_RUN = [
  'network',
  'ls',
  '--quiet',
  '--filter',
  `label=${RUN_LABEL}`,
];

describe('the run network (card tooling-47)', () => {
  it('tooling-47: the network is named after the run', () => {
    strictEqual(runNetworkOf(RUN_ID), NETWORK);
  });

  /** A creation time `seconds` before `nowMilliseconds`, as `{{json .Created}}` prints it. */
  function agedBy(nowMilliseconds: number, seconds: number): string {
    return JSON.stringify(
      new Date(nowMilliseconds - seconds * 1000).toISOString(),
    );
  }

  it('a creation time reads as seconds from its JSON string, and anything else as none', () => {
    deepStrictEqual(
      ['"2026-10-20T19:40:54Z"', '"later"', '12', 'later'].map(field =>
        createdSecondsOf(field),
      ),
      [
        Date.parse('2026-10-20T19:40:54Z') / 1000,
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it("the network age format is one the daemon formats, and its creation time reads back as now's", function () {
    if (runCommand('docker', ['info', '--format', '{{.ID}}']).status !== 0) {
      this.skip();
    }
    const name = `remote-oss-acceptance-format-${String(process.pid)}`;
    runCommand('docker', [
      'network',
      'create',
      '--label',
      `${RUN_LABEL}=format`,
      name,
    ]);
    try {
      const line = runCommand('docker', [
        'network',
        'inspect',
        '--format',
        NETWORK_AGE_FORMAT,
        name,
      ]).stdout.trim();
      const [created = '', containers = ''] = line.split(' ');
      const ageSeconds = Date.now() / 1000 - (createdSecondsOf(created) ?? 0);
      deepStrictEqual(
        [ageSeconds >= 0 && ageSeconds < 120, containers],
        [true, '0'],
      );
    } finally {
      runCommand('docker', ['network', 'rm', name]);
    }
  });

  it('tooling-47: connectRunNetwork creates the labelled network once, connects the host and gives its address', () => {
    const scripted = scriptedCommands();
    scripted.passes(''); // docker network ls, the sweep
    scripted.fails(1, 'No such network'); // docker network inspect
    scripted.passes(); // docker network create
    scripted.passes(); // docker network connect
    scripted.passes('172.18.0.2\n'); // docker inspect, the address

    const address = connectRunNetwork(scripted, RUN_ID, 'c1');

    deepStrictEqual(
      [address, scripted.calls],
      [
        '172.18.0.2',
        [
          {program: 'docker', argv: NETWORKS_OF_ANY_RUN},
          {program: 'docker', argv: ['network', 'inspect', NETWORK]},
          {
            program: 'docker',
            argv: [
              'network',
              'create',
              '--label',
              `${RUN_LABEL}=${RUN_ID}`,
              NETWORK,
            ],
          },
          {program: 'docker', argv: ['network', 'connect', NETWORK, 'c1']},
          {
            program: 'docker',
            argv: [
              'inspect',
              '--format',
              `{{(index .NetworkSettings.Networks "${NETWORK}").IPAddress}}`,
              'c1',
            ],
          },
        ],
      ],
    );
  });

  it('tooling-47: a second host of the run joins the network that is there and creates none', () => {
    const scripted = scriptedCommands();
    scripted.passes(''); // docker network ls, the sweep
    scripted.passes(); // docker network inspect: it exists
    scripted.passes(); // docker network connect
    scripted.passes('172.18.0.3\n'); // docker inspect, the address

    const address = connectRunNetwork(scripted, RUN_ID, 'c2');

    deepStrictEqual(
      [
        address,
        scripted.calls.some(call => call.argv.includes('create')),
        scripted.calls.map(call => call.argv.slice(0, 2).join(' ')),
      ],
      [
        '172.18.0.3',
        false,
        [
          'network ls',
          'network inspect',
          'network connect',
          'inspect --format',
        ],
      ],
    );
  });

  it('tooling-47: the opening sweep removes a labelled network older than two hours with no container, before the run creates its own', () => {
    const scripted = scriptedCommands();
    const nowMilliseconds = 1_000_000_000;
    scripted.passes('stale1\n'); // docker network ls, the sweep
    scripted.passes(`${agedBy(nowMilliseconds, 7201)} 0\n`); // docker network inspect stale1
    scripted.passes(); // docker network rm stale1
    scripted.fails(1, 'No such network'); // docker network inspect, the run's
    scripted.passes(); // docker network create
    scripted.passes(); // docker network connect
    scripted.passes('172.18.0.2\n'); // docker inspect, the address

    connectRunNetwork(scripted, RUN_ID, 'c1', () => nowMilliseconds);

    deepStrictEqual(
      [
        scripted.calls.map(call => call.argv.slice(0, 2).join(' ')),
        scripted.calls[2]?.argv,
      ],
      [
        [
          'network ls',
          'network inspect',
          'network rm',
          'network inspect',
          'network create',
          'network connect',
          'inspect --format',
        ],
        ['network', 'rm', 'stale1'],
      ],
    );
  });

  it('tooling-47: the sweep leaves a younger network, one with a container, and one it cannot read or date', () => {
    const scripted = scriptedCommands();
    const nowMilliseconds = 1_000_000_000;
    scripted.passes('young\nbusy\nunreadable\nodd\nundated\n'); // docker network ls
    scripted.passes(`${agedBy(nowMilliseconds, 7199)} 0\n`); // young
    scripted.passes(`${agedBy(nowMilliseconds, 9000)} 1\n`); // busy
    scripted.fails(1, 'No such network'); // unreadable
    scripted.passes('not two numbers\n'); // odd
    scripted.passes('"yesterday" 0\n'); // undated
    scripted.fails(1, 'No such network'); // docker network inspect, the run's
    scripted.passes(); // docker network create
    scripted.passes(); // docker network connect
    scripted.passes('172.18.0.2\n'); // docker inspect, the address

    connectRunNetwork(scripted, RUN_ID, 'c1', () => nowMilliseconds);

    deepStrictEqual(
      scripted.calls.filter(
        call => call.argv[0] === 'network' && call.argv[1] === 'rm',
      ),
      [],
    );
  });

  it('tooling-47: a stale network that another job removed first does not fail the sweep', () => {
    const scripted = scriptedCommands();
    const nowMilliseconds = 1_000_000_000;
    scripted.passes('gone\n'); // docker network ls
    scripted.passes(`${agedBy(nowMilliseconds, 8000)} 0\n`); // docker network inspect
    scripted.fails(1, 'No such network'); // docker network rm: already removed
    scripted.fails(1, 'No such network'); // docker network inspect, the run's
    scripted.passes(); // docker network create
    scripted.passes(); // docker network connect
    scripted.passes('172.18.0.2\n'); // docker inspect, the address

    strictEqual(
      connectRunNetwork(scripted, RUN_ID, 'c1', () => nowMilliseconds),
      '172.18.0.2',
    );
  });

  it('tooling-47: a host with no address on the run network throws, naming the container and the network', () => {
    const scripted = scriptedCommands();
    scripted.passes(''); // docker network ls
    scripted.fails(1, 'No such network'); // docker network inspect
    scripted.passes(); // docker network create
    scripted.passes(); // docker network connect
    scripted.passes('  \n'); // docker inspect: no address

    throws(
      () => {
        connectRunNetwork(scripted, RUN_ID, 'c1');
      },
      {message: `the host c1 has no address on ${NETWORK}`},
    );
  });

  it('tooling-47: a network that cannot be created fails the run with the error', () => {
    const scripted = scriptedCommands();
    scripted.passes(''); // docker network ls
    scripted.fails(1, 'No such network'); // docker network inspect
    scripted.fails(1, 'all predefined address pools have been fully subnetted'); // docker network create

    throws(() => {
      connectRunNetwork(scripted, RUN_ID, 'c1');
    }, /network create .* all predefined address pools have been fully subnetted/);
  });
});

/** Scripts the answers of one clean-up: what the first listings hold and what the second listings still hold. */
function scriptCleanRun(
  scripted: ReturnType<typeof scriptedCommands>,
  state: {
    containers?: string[];
    networks?: string[];
    leftContainers?: string;
    leftNetworks?: string;
    imageGone?: boolean;
  } = {},
): void {
  const {
    containers = [],
    networks = [],
    leftContainers = '',
    leftNetworks = '',
  } = state;
  scripted.passes(''); // docker ps, the dev containers' images
  scripted.passes(containers.map(name => `${name}\n`).join('')); // docker ps, the first listing
  containers.forEach(() => {
    scripted.passes();
  }); // docker rm --force
  scripted.passes(networks.map(name => `${name}\n`).join('')); // docker network ls, the run's networks
  networks.forEach(() => {
    scripted.passes();
  }); // docker network rm
  scripted.passes(); // pkill
  scripted.passes(); // pkill, stale editors
  for (let index = 0; index < 3; index += 1) {
    // docker image rm --force, the two host tags (Alpine's, Ubuntu's) and the dev container tag
    if (state.imageGone) {
      scripted.fails(1, 'No such image');
    } else {
      scripted.passes();
    }
  }
  scripted.passes(leftContainers); // docker ps, the second listing
  scripted.passes(leftNetworks); // docker network ls, the second listing
}

describe('cleanRun (card tooling-10)', () => {
  it("removes the run's containers by label and its image tag, then proves nothing is left", () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted, {containers: ['c1', 'c2']});

    cleanRun(scripted, RUN_ID);

    deepStrictEqual(scripted.calls, [
      {
        program: 'docker',
        argv: [
          'ps',
          '--all',
          '--filter',
          'label=remote-oss.acceptance.run=77-2',
          '--filter',
          'label=remote-oss.acceptance.devcontainer=1',
          '--format',
          '{{.Image}}',
        ],
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
      {program: 'docker', argv: ['rm', '--force', '--volumes', 'c1']},
      {program: 'docker', argv: ['rm', '--force', '--volumes', 'c2']},
      {
        program: 'docker',
        argv: [
          'network',
          'ls',
          '--quiet',
          '--filter',
          'label=remote-oss.acceptance.run=77-2',
        ],
      },
      {
        program: 'pkill',
        argv: ['-f', '--', 'acceptance-77-2-[A-Za-z0-9]+/user-data'],
      },
      {
        program: 'pkill',
        argv: [
          '-O',
          '7200',
          '-f',
          '--',
          'acceptance-[0-9]+-[0-9]+-[A-Za-z0-9_-]+-[A-Za-z0-9]+/user-data',
        ],
      },
      {
        program: 'docker',
        argv: ['image', 'rm', '--force', 'remote-oss-acceptance-host:77-2'],
      },
      {
        program: 'docker',
        argv: [
          'image',
          'rm',
          '--force',
          'remote-oss-acceptance-host:77-2-ubuntu-26.04',
        ],
      },
      {
        program: 'docker',
        argv: [
          'image',
          'rm',
          '--force',
          'remote-oss-acceptance-devcontainer:77-2',
        ],
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
      {
        program: 'docker',
        argv: [
          'network',
          'ls',
          '--quiet',
          '--filter',
          'label=remote-oss.acceptance.run=77-2',
        ],
      },
    ]);
  });

  it('does not throw when the image is already gone', () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted, {imageGone: true});

    cleanRun(scripted, RUN_ID);

    strictEqual(scripted.calls.length, 10);
  });

  it("throws naming the container when one still carries the run's label", () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted, {leftContainers: 'c9\n'});

    throws(
      () => {
        cleanRun(scripted, RUN_ID);
      },
      {message: 'the run 77-2 still owns containers after the clean-up: c9'},
    );
  });

  it("tooling-47: removes the run's networks after its containers and before the images", () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted, {containers: ['c1'], networks: ['n1', 'n2']});

    cleanRun(scripted, RUN_ID);

    deepStrictEqual(
      scripted.calls
        .filter(
          call =>
            (call.argv[0] === 'network' && call.argv[1] !== 'ls') ||
            call.argv[0] === 'rm' ||
            (call.argv[0] === 'image' && call.argv[1] === 'rm'),
        )
        .map(call => call.argv.join(' ')),
      [
        'rm --force --volumes c1',
        'network rm n1',
        'network rm n2',
        `image rm --force remote-oss-acceptance-host:${RUN_ID}`,
        `image rm --force remote-oss-acceptance-host:${RUN_ID}-ubuntu-26.04`,
        `image rm --force remote-oss-acceptance-devcontainer:${RUN_ID}`,
      ],
    );
  });

  it("tooling-47: throws naming the network when one still carries the run's label", () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted, {leftNetworks: 'n9\n'});

    throws(
      () => {
        cleanRun(scripted, RUN_ID);
      },
      {
        message: `the run ${RUN_ID} still owns networks after the clean-up: n9`,
      },
    );
  });

  it('tooling-47: names the containers and the networks when both are left', () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted, {leftContainers: 'c9\n', leftNetworks: 'n9\n'});

    throws(
      () => {
        cleanRun(scripted, RUN_ID);
      },
      {
        message: `the run ${RUN_ID} still owns containers after the clean-up: c9 and networks after the clean-up: n9`,
      },
    );
  });

  it("prunes nothing and filters every container listing by the run's label alone", () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted, {containers: ['c1']});

    cleanRun(scripted, RUN_ID);

    deepStrictEqual(
      {
        prunesNothing: scripted.calls.every(
          call =>
            !call.program.includes('prune') &&
            !call.argv.some(argValue => argValue.includes('prune')),
        ),
        listings: scripted.calls
          .filter(
            call =>
              call.program === 'docker' &&
              call.argv[0] === 'ps' &&
              call.argv.includes('--quiet'),
          )
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

  it('does not throw when no editor of the run is running', () => {
    const scripted = scriptedCommands();
    scriptCleanRun(scripted);

    cleanRun(scripted, RUN_ID);

    strictEqual(scripted.calls.length, 10);
  });

  it("containers-09: notes the run's dev containers' images before removing the containers, then removes them and the run's dev container tag", () => {
    const scripted = scriptedCommands();
    scripted.passes(
      'vsc-gate-image-0123-uid\nremote-oss-acceptance-devcontainer:77-2\n',
    ); // docker ps, the images
    scripted.passes('d1\nc1\n'); // docker ps, the run's containers
    scripted.passes(); // docker rm --force d1
    scripted.passes(); // docker rm --force c1
    scripted.passes(''); // docker network ls, the run's networks
    scripted.passes(); // pkill
    scripted.passes(); // pkill, stale editors
    scripted.passes(); // docker image rm --force, the host
    scripted.passes(); // docker image rm --force, the Ubuntu host
    scripted.fails(1, 'image is being used'); // docker image rm --force, the uid image
    scripted.passes(); // docker image rm --force, the dev container tag
    scripted.passes(''); // docker ps, the second listing
    scripted.passes(''); // docker network ls, the second listing

    cleanRun(scripted, RUN_ID);

    deepStrictEqual(
      scripted.calls
        .filter(call => call.argv[0] === 'image' || call.argv[0] === 'rm')
        .map(call => call.argv.at(-1)),
      [
        'd1',
        'c1',
        'remote-oss-acceptance-host:77-2',
        'remote-oss-acceptance-host:77-2-ubuntu-26.04',
        'vsc-gate-image-0123-uid',
        'remote-oss-acceptance-devcontainer:77-2',
      ],
    );
  });
});

describe('the dev container image and its sweep (card containers-09)', () => {
  /** Now, in seconds: 2026-10-14T12:00:00Z. */
  const NOW_SECONDS = Date.parse('2026-10-14T12:00:00Z') / 1000;

  it('containers-09: builds the image from the devcontainer-image folder with the run label, the dev container label and the run tag', () => {
    const scripted = scriptedCommands();
    scripted.passes();

    const imageTag = buildDevContainerImage(scripted, '/repo', RUN_ID);

    deepStrictEqual(
      [imageTag, scripted.calls],
      [
        'remote-oss-acceptance-devcontainer:77-2',
        [
          {
            program: 'docker',
            argv: [
              'build',
              '--load',
              '--progress=plain',
              '--label',
              'remote-oss.acceptance.run=77-2',
              '--label',
              'remote-oss.acceptance.devcontainer=1',
              '--tag',
              'remote-oss-acceptance-devcontainer:77-2',
              path.join('/repo', 'tests', 'acceptance', 'devcontainer-image'),
            ],
          },
        ],
      ],
    );
  });

  it("containers-09: the sweep removes only another run's dev containers and images older than two hours", () => {
    const scripted = scriptedCommands();
    scripted.passes('mine\nold\nyoung\n'); // docker ps
    scripted.passes(
      [
        'mine 77-2 2026-10-14T08:00:00Z',
        'old 12-1-build 2026-10-14T09:00:00.123456789Z',
        'young 12-2-build 2026-10-14T11:50:00Z',
      ].join('\n'),
    ); // docker inspect
    scripted.passes(); // docker rm --force old
    scripted.passes('sha256:a\nsha256:b\n'); // docker image ls
    scripted.passes(
      [
        'sha256:a 12-1-build 2026-10-14T09:00:00Z',
        'sha256:b 12-2-build 2026-10-14T11:50:00Z',
      ].join('\n'),
    ); // docker image inspect
    scripted.fails(1, 'image is being used'); // docker image rm --force sha256:a

    sweepStaleDevContainers(scripted, RUN_ID, NOW_SECONDS);

    deepStrictEqual(
      scripted.calls
        .filter(call => call.argv.includes('rm'))
        .map(call => call.argv),
      [
        ['rm', '--force', '--volumes', 'old'],
        ['image', 'rm', '--force', 'sha256:a'],
      ],
    );
  });

  it('containers-09: a sweep with no labelled container or image inspects nothing', () => {
    const scripted = scriptedCommands();
    scripted.passes(''); // docker ps
    scripted.passes(''); // docker image ls

    sweepStaleDevContainers(scripted, RUN_ID, NOW_SECONDS);

    deepStrictEqual(
      scripted.calls.map(call => call.argv.slice(0, 2)),
      [
        ['ps', '--all'],
        ['image', 'ls'],
      ],
    );
  });
});
