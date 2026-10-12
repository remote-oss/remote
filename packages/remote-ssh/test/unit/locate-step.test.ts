import {deepStrictEqual} from 'node:assert';
import type {ProcessHandle, ProcessSpawner} from 'lib-ssh';
import {
  type ClientPrograms,
  locateClientStep,
} from '../../src/pipeline/locate-step.ts';
import {INPUT} from './pipeline.fixture.ts';

/** How a fake program answers `-V`: a banner and a status, a start failure, or no exit at all. */
type Answer =
  | {kind: 'banner'; stream: 'out' | 'error'; text: string; status: number}
  | {kind: 'refuse'}
  | {kind: 'hang'};

/** A spawner whose programs answer from `answers`, recording the programs started and the ones killed. */
function spawnerOf(
  answers: Readonly<Record<string, Answer>>,
  seen: {started: string[]; killed: string[]},
): ProcessSpawner {
  return specification => {
    const answer = answers[specification.program] ?? {kind: 'refuse'};
    if (answer.kind === 'refuse') {
      return Promise.reject(new Error('not found'));
    }
    seen.started.push(
      `${specification.program} ${specification.programArguments.join(' ')}`,
    );
    const handle: ProcessHandle = {
      onOutput: listener => {
        if (answer.kind === 'banner' && answer.stream === 'out') {
          queueMicrotask(() => {
            listener(answer.text);
          });
        }
      },
      onError: listener => {
        if (answer.kind === 'banner' && answer.stream === 'error') {
          queueMicrotask(() => {
            listener(answer.text);
          });
        }
      },
      onExit: listener => {
        if (answer.kind === 'banner') {
          setTimeout(() => {
            listener(answer.status);
          }, 1);
        }
      },
      write: () => Promise.resolve(),
      endInput: () => undefined,
      kill: () => {
        seen.killed.push(specification.program);
      },
    };
    return Promise.resolve(handle);
  };
}

/** The program name the search path finds. */
const SSH_PROGRAM = 'ssh';

const OPENSSH: Answer = {
  kind: 'banner',
  stream: 'error',
  text: 'OpenSSH_9.6p1, OpenSSL 3.0.13',
  status: 0,
};

/** Runs the step once and gives its result, what it kept, and what the spawner saw. */
async function located(
  answers: Readonly<Record<string, Answer>>,
  settingValue = '',
): Promise<{
  result: Awaited<ReturnType<ReturnType<typeof locateClientStep>>>;
  kept: ClientPrograms[];
  seen: {started: string[]; killed: string[]};
}> {
  const seen = {started: [] as string[], killed: [] as string[]};
  const kept: ClientPrograms[] = [];
  const step = locateClientStep({
    settingValue: () => settingValue,
    environment: {searchPath: '/usr/bin', programFilesFolder: ''},
    platform: 'linux',
    spawner: spawnerOf(answers, seen),
    processEnvironment: {},
    checkMilliseconds: 20,
    keep: programs => {
      kept.push(programs);
    },
  });
  const result = await step(INPUT);
  return {result, kept, seen};
}

describe('the step that finds the ssh client', () => {
  it('F-2101: the ssh on the search path is accepted, with scp by name', async () => {
    const {result, kept} = await located({[SSH_PROGRAM]: OPENSSH});
    deepStrictEqual(
      [result, kept],
      [
        {kind: 'done', value: undefined},
        [{sshProgram: 'ssh', scpProgram: 'scp'}],
      ],
    );
  });

  it('F-2101: the setting comes first, and scp is taken beside it', async () => {
    const {kept} = await located(
      {'/opt/ssh/bin/ssh': OPENSSH, [SSH_PROGRAM]: OPENSSH},
      '/opt/ssh/bin/ssh',
    );
    deepStrictEqual(kept, [
      {sshProgram: '/opt/ssh/bin/ssh', scpProgram: '/opt/ssh/bin/scp'},
    ]);
  });

  it('F-2101: each candidate is checked with -V only', async () => {
    const {seen} = await located({[SSH_PROGRAM]: OPENSSH});
    deepStrictEqual(seen.started, ['ssh -V']);
  });

  it('F-2101: a banner on standard output is accepted too', async () => {
    const {kept} = await located({
      [SSH_PROGRAM]: {
        kind: 'banner',
        stream: 'out',
        text: 'OpenSSH_9.6',
        status: 0,
      },
    });
    deepStrictEqual(kept.length, 1);
  });

  it('F-2101 7.E1: a configured program that is not OpenSSH falls through to the search path', async () => {
    const {kept} = await located(
      {
        '/opt/other': {
          kind: 'banner',
          stream: 'error',
          text: 'Dropbear',
          status: 0,
        },
        [SSH_PROGRAM]: OPENSSH,
      },
      '/opt/other',
    );
    deepStrictEqual(kept[0]?.sshProgram, 'ssh');
  });

  it('F-2101: a banner with a failing status is not accepted', async () => {
    const {result} = await located({
      [SSH_PROGRAM]: {
        kind: 'banner',
        stream: 'error',
        text: 'OpenSSH_9.6',
        status: 1,
      },
    });
    deepStrictEqual(result.kind, 'failed');
  });

  it('F-2101: a program that does not answer in time is killed and not accepted', async () => {
    const {result, seen} = await located({[SSH_PROGRAM]: {kind: 'hang'}});
    deepStrictEqual([result.kind, seen.killed], ['failed', ['ssh']]);
  });

  it('F-2101 S009: no accepted client fails with the missing-installation reason', async () => {
    const {result, kept} = await located({});
    deepStrictEqual(
      [result, kept],
      [
        {
          kind: 'failed',
          failure: {kind: 'prerequisiteMissing', reason: {id: 'S009'}},
        },
        [],
      ],
    );
  });
});
