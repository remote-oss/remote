import {deepStrictEqual, rejects} from 'node:assert';
import {
  daemonLock,
  LOCK_NETWORK,
  LOCK_WAIT_MILLISECONDS,
  NO_LOCK,
} from './acceptance-lock.ts';
import type {CommandResult} from './command-runner.ts';

/** The holder's objects on the daemon: by default it is alive, with its run network and a container. */
const ALIVE = {
  containers: {status: 0, stdout: 'f00d\n', stderr: ''},
  networks: {
    status: 0,
    stdout: `remote-oss-acceptance-run-b\n${LOCK_NETWORK}\n`,
    stderr: '',
  },
};

/**
 * A daemon that answers the lock's commands from a script, one answer per call of each kind, with the holder's
 * containers and networks as `holder` gives them, and a clock.
 */
function scripted(answers: {
  creates: CommandResult[];
  inspects?: CommandResult[];
  holder?: {containers: CommandResult; networks: CommandResult};
}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const sleeps: number[] = [];
  let now = 1_000_000_000_000;
  const creates = [...answers.creates];
  const inspects = [...(answers.inspects ?? [])];
  const lock = daemonLock(
    (program, programArguments) => {
      calls.push([program, ...programArguments].join(' '));
      const holder = answers.holder ?? ALIVE;
      const [noun = '', verb = ''] = programArguments;
      const next =
        verb === 'create'
          ? creates.shift()
          : verb === 'inspect'
            ? inspects.shift()
            : noun === 'ps'
              ? holder.containers
              : verb === 'ls'
                ? holder.networks
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

const MADE: CommandResult = {status: 0, stdout: 'net-id\n', stderr: ''};
const EXISTS: CommandResult = {
  status: 1,
  stdout: '',
  stderr: `Error response from daemon: network with name ${LOCK_NETWORK} already exists\n`,
};
/** The holder `run-b`, whose lock is 300 s old at the scripted clock's start. */
const HELD_BY_B: CommandResult = {
  status: 0,
  stdout: `run-b ${String(1_000_000_000 - 300)}\n`,
  stderr: '',
};
const GONE: CommandResult = {
  status: 1,
  stdout: '',
  stderr: 'Error: No such network\n',
};

describe("the Docker daemon's dev container lock", () => {
  it('a free lock is taken at once by making its network with the run label, and released by removing it', async () => {
    const {lock, calls, lines, sleeps} = scripted({creates: [MADE]});
    await lock.take();
    lock.release();
    deepStrictEqual(
      [calls, lines, sleeps],
      [
        [
          `docker network create --label remote-oss.acceptance.run=run-a ${LOCK_NETWORK}`,
          `docker network rm ${LOCK_NETWORK}`,
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

  it('a lock whose run left no container and no other network is removed and taken at once, saying so', async () => {
    const {lock, calls, lines, sleeps} = scripted({
      creates: [EXISTS, MADE],
      inspects: [HELD_BY_B],
      holder: {
        containers: {status: 0, stdout: '', stderr: ''},
        networks: {status: 0, stdout: `${LOCK_NETWORK}\n`, stderr: ''},
      },
    });
    await lock.take();
    deepStrictEqual(
      [lines, sleeps, calls.filter(call => call.includes(' rm '))],
      [
        [
          "acceptance: the Docker daemon's dev container lock of run run-b is left from a run that is gone; removing it",
        ],
        [],
        [`docker network rm ${LOCK_NETWORK}`],
      ],
    );
  });

  it('a holder whose listings fail counts as alive: the launch waits, and the lock stays', async () => {
    const failed = {status: 1, stdout: '', stderr: 'error\n'};
    const {lock, calls, sleeps} = scripted({
      creates: [EXISTS, MADE],
      inspects: [HELD_BY_B],
      holder: {containers: failed, networks: failed},
    });
    await lock.take();
    deepStrictEqual(
      [sleeps, calls.filter(call => call.includes(' rm '))],
      [[10_000], []],
    );
  });

  it('a holder with only its run network left, or only a container, is alive', async () => {
    const seen = [];
    for (const holder of [
      {
        containers: {status: 0, stdout: '', stderr: ''},
        networks: ALIVE.networks,
      },
      {
        containers: ALIVE.containers,
        networks: {status: 0, stdout: `${LOCK_NETWORK}\n`, stderr: ''},
      },
    ]) {
      const {lock, sleeps} = scripted({
        creates: [EXISTS, MADE],
        inspects: [HELD_BY_B],
        holder,
      });
      await lock.take();
      seen.push(sleeps.length);
    }
    deepStrictEqual(seen, [1, 1]);
  });

  it('the lock of a launch that needs none is taken at once and released with nothing to do', async () => {
    const taken = await NO_LOCK.take().then(() => 'taken');
    NO_LOCK.release();
    deepStrictEqual(taken, 'taken');
  });
});
