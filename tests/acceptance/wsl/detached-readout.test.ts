import {strictEqual} from 'node:assert';
import type {HostChannel} from 'lib-host';
import {
  inDistro,
  installedDistro,
  readout,
  realChannel,
} from './channel-support.ts';

/** The columns of a process line: its id, parent, process group, session, state and command. */
const PROCESS_COLUMNS = 'pid=,ppid=,pgid=,sid=,stat=,comm=';

/** The wait after a run ends at which the readouts check the process again, in seconds. */
const CHECKS_AT = [5, 30];

/** A way to start a long-lived process in a run, and the lines of ids it prints before the run ends. */
interface Variant {
  name: string;
  /** The script: starts the process, prints `child <id>`, then the ids of the child and of the shell, then ends. */
  script: string;
}

/** The script text that prints the ids of the process `$CHILD` and of the shell `$$`. */
const PRINT_IDS = `printf 'child %s\\n' "$CHILD"; ps -o ${PROCESS_COLUMNS} -p "$CHILD" "$$"`;

const VARIANTS: readonly Variant[] = [
  {
    name: 'nohup',
    script: `nohup sleep 40 </dev/null >/dev/null 2>&1 & CHILD=$!; ${PRINT_IDS}`,
  },
  {
    name: 'setsid',
    script: `setsid sleep 40 </dev/null >/dev/null 2>&1 & CHILD=$!; ${PRINT_IDS}`,
  },
  {
    name: 'server start shape',
    script: [
      "printf '#!/bin/sh\\nexec sleep 600\\n' > /tmp/readout-launcher.sh",
      'chmod +x /tmp/readout-launcher.sh',
      ': > /tmp/readout-server.log',
      'nohup /tmp/readout-launcher.sh </dev/null >/tmp/readout-server.log 2>&1 8>&- 9>&- &',
      'CHILD=$!',
      'echo "$CHILD" > /tmp/readout-server.pid',
      'sleep 2',
      PRINT_IDS,
    ].join('\n'),
  },
];

/** The lines a script prints and how it ended. */
async function runLines(
  channel: HostChannel,
  script: string,
  cancellation: AbortSignal,
): Promise<{lines: string[]; kind: string}> {
  const lines: string[] = [];
  const outcome = await channel.runScript(
    {
      script,
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: ''},
      cancellation,
    },
    line => lines.push(line),
  );
  return {
    lines,
    kind: outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
  };
}

/** Waits `seconds`. */
function wait(seconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, seconds * 1000);
  });
}

describe('what real WSL does to a process a run started (card #3312, ruling-3312-detached-case readouts)', function () {
  this.timeout(300_000);
  const distro = installedDistro();
  const channel = realChannel(distro);
  const started: number[] = [];

  after(() => {
    for (const processId of started) {
      inDistro(distro, 'kill', '-9', String(processId));
    }
  });

  /** The ids of process `processId` now, as a readout line, and whether it runs. */
  function observe(name: string, processId: number, when: string): boolean {
    const shown = inDistro(
      distro,
      'ps',
      '-o',
      PROCESS_COLUMNS,
      '-p',
      String(processId),
    );
    const alive =
      inDistro(distro, 'kill', '-0', String(processId)).status === 0;
    readout(
      distro,
      `${name}: process ${String(processId)} ${when}: alive ${String(alive)}, ids [${shown.text.replaceAll('\n', ' | ')}]`,
    );
    return alive;
  }

  /** Runs each variant to its end, then checks its process at once and `CHECKS_AT` seconds after the last run ended. */
  async function startAndWatch(
    held: boolean,
  ): Promise<ReadonlyArray<readonly [string, boolean[]]>> {
    const relay = new AbortController();
    const relaying = held
      ? runLines(channel, 'printf "relay\\n"; sleep 300', relay.signal)
      : Promise.resolve({lines: [], kind: 'none'});
    await wait(held ? 2 : 0);
    const watched: Array<{name: string; processId: number}> = [];
    for (const variant of VARIANTS) {
      readout(
        distro,
        `${variant.name}: run starting${held ? ' beside a held run' : ''}`,
      );
      const finished = await runLines(
        channel,
        variant.script,
        new AbortController().signal,
      );
      const child = finished.lines.find(line => line.startsWith('child '));
      const processId = Number(child?.slice('child '.length));
      started.push(processId);
      readout(
        distro,
        `${variant.name}: run ended ${finished.kind}; inside the run: ${finished.lines.join(' | ')}`,
      );
      watched.push({name: variant.name, processId});
      observe(variant.name, processId, 'right after its run ended');
    }
    const results = new Map<string, boolean[]>(
      watched.map(each => [each.name, []]),
    );
    let waited = 0;
    for (const mark of CHECKS_AT) {
      await wait(mark - waited);
      waited = mark;
      for (const each of watched) {
        results
          .get(each.name)
          ?.push(
            observe(
              each.name,
              each.processId,
              `${String(mark)} s after the last run ended`,
            ),
          );
      }
    }
    relay.abort();
    await relaying;
    return [...results.entries()];
  }

  it('readout: each way of starting a process, with no other run attached', async () => {
    strictEqual((await startAndWatch(false)).length, VARIANTS.length);
  });

  it('readout: each way of starting a process, beside a run that stays attached (a stand-in for a connected window)', async () => {
    strictEqual((await startAndWatch(true)).length, VARIANTS.length);
  });

  /** How many of `count` runs of `script` left a process alive right after the run and 5 s after the last run. */
  async function repeated(
    name: string,
    script: string,
    count: number,
  ): Promise<{right: number; later: number}> {
    const processes: number[] = [];
    let right = 0;
    for (let index = 0; index < count; index += 1) {
      const finished = await runLines(
        channel,
        script,
        new AbortController().signal,
      );
      const processId = Number(finished.lines[0]);
      started.push(processId);
      processes.push(processId);
      right += observe(
        `${name} #${String(index + 1)}`,
        processId,
        'right after its run ended',
      )
        ? 1
        : 0;
    }
    await wait(5);
    const later = processes.filter(processId =>
      observe(name, processId, '5 s later'),
    ).length;
    readout(
      distro,
      `${name}: of ${String(count)} runs, ${String(right)} alive right after, ${String(later)} alive 5 s later`,
    );
    return {right, later};
  }

  it('readout: the contract script run ten times ends at once; the same with a 1 s wait before it ends; setsid measured by the sleep itself', async () => {
    const immediate = await repeated(
      'immediate',
      `nohup sleep 40 </dev/null >/dev/null 2>&1 & printf '%s\\n' "$!"`,
      10,
    );
    const waiting = await repeated(
      'wait 1 s',
      `nohup sleep 40 </dev/null >/dev/null 2>&1 & printf '%s\\n' "$!"; sleep 1`,
      10,
    );
    const setsid = await repeated(
      'setsid, the sleep itself',
      "setsid sleep 4001 </dev/null >/dev/null 2>&1 & sleep 0.5; pgrep -n -f '[s]leep 4001'",
      3,
    );
    strictEqual(
      [immediate, waiting, setsid].every(each => each.right >= 0),
      true,
    );
  });
});
