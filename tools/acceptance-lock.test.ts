import {deepStrictEqual, rejects} from 'node:assert';
import {
  daemonLock,
  HOLDER_FORMAT,
  holderOf,
  HOST_LABEL,
  LOCK_NETWORK,
  LOCK_WAIT_MILLISECONDS,
  NO_LOCK,
  nodeProcessAlive,
} from './acceptance-lock.ts';
import {RUN_LABEL} from './acceptance-run.ts';
import {type CommandResult, runCommand} from './command-runner.ts';

/** The scripted clock's start, in milliseconds. */
const START = 1_000_000_000_000;

/**
 * A daemon that answers the lock's commands from a script, one answer per call of each kind, on host `host-a`, where
 * the processes `dead` have ended, and a clock.
 */
function scripted(answers: {
  creates: CommandResult[];
  inspects?: CommandResult[];
  dead?: number[];
}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const sleeps: number[] = [];
  let now = START;
  const creates = [...answers.creates];
  const inspects = [...(answers.inspects ?? [])];
  const lock = daemonLock(
    (program, programArguments) => {
      calls.push([program, ...programArguments].join(' '));
      const verb = programArguments[1];
      const next =
        verb === 'create'
          ? creates.shift()
          : verb === 'inspect'
            ? inspects.shift()
            : undefined;
      return next ?? {status: 0, stdout: '', stderr: ''};
    },
    'run-a',
    {
      now: () => now,
      sleep: milliseconds => {
        sleeps.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
      hostName: 'host-a',
      processAlive: processId => !(answers.dead ?? []).includes(processId),
    },
    line => {
      lines.push(line);
    },
  );
  return {
    lock,
    calls,
    lines,
    sleeps,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

const MADE: CommandResult = {status: 0, stdout: 'net-a\n', stderr: ''};
const EXISTS: CommandResult = {
  status: 1,
  stdout: '',
  stderr: `Error response from daemon: network with name ${LOCK_NETWORK} already exists\n`,
};
const GONE: CommandResult = {
  status: 1,
  stdout: '',
  stderr: 'Error: No such network\n',
};

/** The lock as `docker network inspect` shows it: made 300 s before the scripted clock's start. */
function heldBy(holderRun: string, host: string): CommandResult {
  return {
    status: 0,
    stdout: `net-old ${JSON.stringify(new Date(START - 300_000).toISOString())} ${holderRun} ${host}\n`,
    stderr: '',
  };
}

const HELD_BY_B = heldBy('run-b', 'host-b');

/** The `docker network rm` calls a script made. */
function removals(calls: readonly string[]): string[] {
  return calls.filter(call => call.startsWith('docker network rm '));
}

describe("the Docker daemon's dev container lock", () => {
  it('a free lock is taken at once by making its network with the run and host labels, and released by its id', async () => {
    const {lock, calls, lines, sleeps} = scripted({creates: [MADE]});
    await lock.take();
    lock.release();
    deepStrictEqual(
      [calls, lines, sleeps],
      [
        [
          `docker network create --label remote-oss.acceptance.run=run-a --label ${HOST_LABEL}=host-a ${LOCK_NETWORK}`,
          'docker network rm net-a',
        ],
        [],
        [],
      ],
    );
  });

  it("a held lock makes the launch wait, saying whose it is and for how long, then take it once it's free", async () => {
    const {lock, lines, sleeps} = scripted({
      creates: [EXISTS, EXISTS, MADE],
      inspects: [HELD_BY_B, HELD_BY_B],
    });
    await lock.take();
    deepStrictEqual(
      [lines, sleeps],
      [
        [
          "acceptance: waiting for the Docker daemon's dev container lock, held by run run-b for 300 s",
        ],
        [10_000, 10_000],
      ],
    );
  });

  it('a long wait says who holds the lock once a minute, not at every try', async () => {
    const {lock, lines} = scripted({
      creates: [...Array<CommandResult>(8).fill(EXISTS), MADE],
      inspects: Array<CommandResult>(8).fill(HELD_BY_B),
    });
    await lock.take();
    deepStrictEqual(lines, [
      "acceptance: waiting for the Docker daemon's dev container lock, held by run run-b for 300 s",
      "acceptance: waiting for the Docker daemon's dev container lock, held by run run-b for 360 s",
    ]);
  });

  it('a lock still held after the wait limit fails the launch with the holder named', async () => {
    const {lock, advance} = scripted({
      creates: [EXISTS, EXISTS],
      inspects: [HELD_BY_B, HELD_BY_B],
    });
    const taking = lock.take();
    advance(LOCK_WAIT_MILLISECONDS);
    await rejects(taking, {
      message:
        "the Docker daemon's dev container lock is still held by run run-b after 100 minutes (held for 6310 s)",
    });
  });

  it('a lock released between the create and the inspect is taken by the next create, with no wait', async () => {
    const {lock, sleeps, lines} = scripted({
      creates: [EXISTS, MADE],
      inspects: [GONE],
    });
    await lock.take();
    deepStrictEqual([sleeps, lines], [[], []]);
  });

  it("a create the daemon itself refuses is the run's failure, not a wait", async () => {
    const {lock} = scripted({
      creates: [
        {
          status: 1,
          stdout: '',
          stderr:
            'Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n',
        },
      ],
      inspects: [GONE],
    });
    await rejects(lock.take(), {
      message: `docker network create ${LOCK_NETWORK}: Cannot connect to the Docker daemon at unix:///var/run/docker.sock`,
    });
  });

  it("the lock of a local run of this host whose process has ended is removed by its network's id and taken at once", async () => {
    const {lock, calls, lines, sleeps} = scripted({
      creates: [EXISTS, MADE],
      inspects: [heldBy('local-4242', 'host-a')],
      dead: [4242],
    });
    await lock.take();
    deepStrictEqual(
      [lines, sleeps, removals(calls)],
      [
        [
          "acceptance: the Docker daemon's dev container lock of run local-4242 is left from a run that has ended; removing it",
        ],
        [],
        ['docker network rm net-old'],
      ],
    );
  });

  it('a local run whose process is alive, or one of another host, keeps its lock: the launch waits', async () => {
    const seen = [];
    for (const holder of [
      heldBy('local-4242', 'host-a'),
      heldBy('local-4242', 'host-b'),
    ]) {
      const {lock, calls, sleeps} = scripted({
        creates: [EXISTS, MADE],
        inspects: [holder],
        dead: holder.stdout.includes('host-b') ? [4242] : [],
      });
      await lock.take();
      seen.push([sleeps.length, removals(calls)]);
    }
    deepStrictEqual(seen, [
      [1, []],
      [1, []],
    ]);
  });

  it("a lock that exists but can't be read twice in a row fails the take with the inspect's error, never a loop", async () => {
    const {lock, calls} = scripted({
      creates: [EXISTS, EXISTS],
      inspects: [GONE, GONE],
    });
    const failure = await lock.take().then(
      () => 'taken',
      (error: unknown) => (error as Error).message,
    );
    deepStrictEqual(
      [failure, calls.length],
      [`docker network inspect ${LOCK_NETWORK}: Error: No such network`, 4],
    );
  });

  it('a lock whose creation time reads as no time is waited for, held for an unknown time', async () => {
    const {lock, lines} = scripted({
      creates: [EXISTS, MADE],
      inspects: [
        {status: 0, stdout: 'net-old "later" run-b host-b\n', stderr: ''},
      ],
    });
    await lock.take();
    deepStrictEqual(lines, [
      "acceptance: waiting for the Docker daemon's dev container lock, held by run run-b for an unknown time",
    ]);
  });

  it('the holder format is one the daemon formats, and its line reads back as the lock it made', function () {
    if (runCommand('docker', ['info', '--format', '{{.ID}}']).status !== 0) {
      this.skip();
    }
    const name = `remote-oss-acceptance-holder-format-${String(process.pid)}`;
    const made = runCommand('docker', [
      'network',
      'create',
      '--label',
      `${RUN_LABEL}=local-1`,
      '--label',
      `${HOST_LABEL}=host-z`,
      name,
    ]).stdout.trim();
    try {
      const holder = holderOf(
        runCommand('docker', [
          'network',
          'inspect',
          '--format',
          HOLDER_FORMAT,
          name,
        ]).stdout,
      );
      const ageSeconds = Date.now() / 1000 - (holder.createdSeconds ?? 0);
      deepStrictEqual(
        [
          holder.networkId,
          holder.holderRun,
          holder.holderHost,
          ageSeconds >= 0 && ageSeconds < 120,
        ],
        [made, 'local-1', 'host-z', true],
      );
    } finally {
      runCommand('docker', ['network', 'rm', name]);
    }
  });

  it('a release with no lock taken removes nothing, and a second release removes nothing more', async () => {
    const {lock, calls} = scripted({creates: [MADE]});
    lock.release();
    await lock.take();
    lock.release();
    lock.release();
    deepStrictEqual(removals(calls), ['docker network rm net-a']);
  });

  it('the lock of a launch that needs none is taken at once and released with nothing to do', async () => {
    const taken = await NO_LOCK.take().then(() => 'taken');
    NO_LOCK.release();
    deepStrictEqual(taken, 'taken');
  });

  it('a process of this host is alive while it runs, and one that does not exist is not', () => {
    deepStrictEqual(
      [nodeProcessAlive(process.pid), nodeProcessAlive(2 ** 30)],
      [true, false],
    );
  });
});
