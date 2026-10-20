import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ProcessHandle, ProcessSpecification} from 'lib-ssh';
import {connect} from '../../src/pipeline/connect.ts';
import {preconnectStep} from '../../src/pipeline/preconnect-step.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {contentHashOf} from '../../src/preconnect/approvals.ts';
import type {PreconnectAnswer} from '../../src/surfaces/preconnect-dialog.ts';
import {INPUT, setup, steps} from './pipeline.fixture.ts';

/** The alias of the fixture's input, `dev`. */
const ALIAS = 'dev';

const HOME = '/home/alex';
const WORK = '/work';
const SCRIPT = '/scripts/renew.sh';
const BYTES = new TextEncoder().encode('#!/bin/sh\n');
const OTHER_BYTES = new TextEncoder().encode('#!/bin/sh\necho changed\n');

/** What the script's process does when it is started. */
type Behaviour = (process: FakeProcess) => void;

/** A started process the test drives. */
class FakeProcess implements ProcessHandle {
  inputEnded = false;
  killed = false;
  private readonly outputs: Array<(chunk: string) => void> = [];
  private readonly errors: Array<(chunk: string) => void> = [];
  private readonly exits: Array<(status: number | undefined) => void> = [];

  onOutput(listener: (chunk: string) => void): void {
    this.outputs.push(listener);
  }
  onError(listener: (chunk: string) => void): void {
    this.errors.push(listener);
  }
  onExit(listener: (status: number | undefined) => void): void {
    this.exits.push(listener);
  }
  write(): Promise<void> {
    return Promise.resolve();
  }
  endInput(): void {
    this.inputEnded = true;
  }
  kill(): void {
    this.killed = true;
  }
  printLine(chunk: string): void {
    this.outputs.forEach(listener => {
      listener(chunk);
    });
  }
  complain(chunk: string): void {
    this.errors.forEach(listener => {
      listener(chunk);
    });
  }
  end(status: number | undefined): void {
    this.exits.forEach(listener => {
      listener(status);
    });
  }
}

/** The world a run of the step sees, and what it did in it. */
class Scene {
  files = new Map<string, Uint8Array | Error>([[SCRIPT, BYTES]]);
  present = new Set<string>([SCRIPT]);
  answers: Array<PreconnectAnswer | 'aborted'> = ['allow'];
  asked: Array<{path: string; changed: boolean}> = [];
  stored = new Map<string, string>();
  spawned: ProcessSpecification[] = [];
  spawnError: Error | undefined;
  behaviour: Behaviour = process => {
    process.end(0);
  };
  processes: FakeProcess[] = [];
  phases: string[] = [];
  prompts = 0;
  readonly sink = new MemorySink();
  readonly abort = new AbortController();

  /** The logged lines as `level: message`. */
  logged(): string[] {
    return this.sink.lines.map(line => `${line.level}: ${line.message}`);
  }

  /** Runs the step once. */
  execute(
    setting: unknown,
    input: ConnectInput = INPUT,
  ): ReturnType<ReturnType<typeof preconnectStep>> {
    const step = preconnectStep({
      setting: () => setting,
      onRunning: () => {
        this.phases.push('running');
      },
      prompting:
        question =>
        (...argumentList) => {
          this.prompts += 1;
          return question(...argumentList);
        },
      ports: {
        readFile: file => {
          const content = this.files.get(file);
          if (content instanceof Error) {
            return Promise.reject(content);
          }
          return content === undefined
            ? Promise.reject(
                new Error(`ENOENT: no such file or directory, open '${file}'`),
              )
            : Promise.resolve(content);
        },
        exists: file => Promise.resolve(this.present.has(file)),
        spawner: specification => {
          this.spawned.push(specification);
          if (this.spawnError !== undefined) {
            return Promise.reject(this.spawnError);
          }
          const process = new FakeProcess();
          this.processes.push(process);
          setTimeout(() => {
            this.behaviour(process);
          }, 0);
          return Promise.resolve(process);
        },
        environment: {PATH: '/usr/bin'},
        workingDirectory: WORK,
        home: HOME,
        approvals: {
          hashFor: file => this.stored.get(file),
          remember: (file, hash) => {
            this.stored.set(file, hash);
            return Promise.resolve();
          },
        },
        dialog: {
          askUser: (file, changed) => {
            this.asked.push({path: file, changed});
            return Promise.resolve(this.answers.shift() ?? 'skip');
          },
        },
        logger: createLogger(this.sink, {minimumLevel: (): Level => 'info'}),
      },
    });
    return step(input, this.abort.signal);
  }
}

const DONE = {kind: 'done', value: undefined};

/** The failure the step gives for the text shown after the host's name. */
function failedWith(text: string) {
  return {kind: 'failed', failure: {kind: 'preconnectFailed', reason: {text}}};
}

/** The two error lines a failure with this detail logs. */
function failureLines(detail: string): string[] {
  return [
    `error: the pre-connection script failed: ${detail}`,
    `error: [PreconnectScriptFailure]: The pre-connect script has failed (${detail})`,
  ];
}

describe('the pre-connection script step (card connect-87)', () => {
  it('F-2108 AC-2: with no script nothing is told, asked or logged', async () => {
    const scene = new Scene();
    const results = [
      await scene.execute(undefined),
      await scene.execute(''),
      await scene.execute({other: SCRIPT}),
      await scene.execute({[ALIAS]: null}),
    ];
    deepStrictEqual(
      [results, scene.phases, scene.prompts, scene.logged(), scene.spawned],
      [[DONE, DONE, DONE, DONE], [], 0, [], []],
    );
  });

  it('F-2108 AC-3, AC-6: a script is told as the running stage first, and Allow runs it without arguments, with the editor environment and the input closed', async () => {
    const scene = new Scene();
    const result = await scene.execute(SCRIPT);
    deepStrictEqual(
      [
        result,
        scene.phases,
        scene.prompts,
        scene.spawned,
        scene.processes.map(process => process.inputEnded),
        scene.logged(),
      ],
      [
        DONE,
        ['running'],
        1,
        [
          {
            program: SCRIPT,
            programArguments: [],
            environment: {PATH: '/usr/bin'},
          },
        ],
        [true],
        [`info: running the pre-connection script ${SCRIPT}`],
      ],
    );
  });

  it('F-2108 AC-7: each chunk of output is one line, with a trailing line feed cut, and standard error is marked', async () => {
    const scene = new Scene();
    scene.behaviour = process => {
      process.printLine('one\n');
      process.printLine('two\n\n');
      process.complain('trouble');
      process.end(0);
    };
    await scene.execute(SCRIPT);
    deepStrictEqual(scene.logged().slice(1), [
      'info: [preconnect] one',
      'info: [preconnect] two\n',
      'info: [preconnect (stderr)] trouble',
    ]);
  });

  it('F-2108 AC-4, AC-13: the dialog is asked with the path and the plain message when nothing is stored', async () => {
    const scene = new Scene();
    await scene.execute(SCRIPT);
    deepStrictEqual(scene.asked, [{path: SCRIPT, changed: false}]);
  });

  it('F-2108 AC-10: Skip leaves the script out, stores nothing and goes on', async () => {
    const scene = new Scene();
    scene.answers = ['skip'];
    const result = await scene.execute(SCRIPT);
    deepStrictEqual(
      [result, scene.spawned, [...scene.stored], scene.logged()],
      [DONE, [], [], ['info: the user skipped the pre-connection script']],
    );
  });

  it("F-2108 AC-23: Don't Ask Again stores the hash of the contents before the script runs", async () => {
    const scene = new Scene();
    scene.answers = ['allowAlways'];
    let storedWhenSpawned: string[] = [];
    scene.behaviour = process => {
      storedWhenSpawned = [...scene.stored.values()];
      process.end(0);
    };
    await scene.execute(SCRIPT);
    deepStrictEqual(
      [[...scene.stored], storedWhenSpawned],
      [[[SCRIPT, contentHashOf(BYTES)]], [contentHashOf(BYTES)]],
    );
  });

  it('F-2108 AC-12, AC-39: contents that match the stored hash run with no dialog, also after the file was touched', async () => {
    const scene = new Scene();
    scene.stored.set(SCRIPT, contentHashOf(BYTES));
    const result = await scene.execute(SCRIPT);
    deepStrictEqual([result, scene.asked, scene.spawned.length], [DONE, [], 1]);
  });

  it('F-2108 AC-14, AC-13: contents that differ from the stored hash are logged, and the dialog says they changed; Allow keeps the old entry', async () => {
    const scene = new Scene();
    scene.stored.set(SCRIPT, contentHashOf(OTHER_BYTES));
    const result = await scene.execute(SCRIPT);
    deepStrictEqual(
      [result, scene.asked, scene.stored.get(SCRIPT), scene.logged()[0]],
      [
        DONE,
        [{path: SCRIPT, changed: true}],
        contentHashOf(OTHER_BYTES),
        "info: the pre-connection script's contents have changed since the last confirmation",
      ],
    );
  });

  it("F-2108 AC-14: Don't Ask Again on changed contents replaces the entry", async () => {
    const scene = new Scene();
    scene.stored.set(SCRIPT, contentHashOf(OTHER_BYTES));
    scene.answers = ['allowAlways'];
    await scene.execute(SCRIPT);
    deepStrictEqual(scene.stored.get(SCRIPT), contentHashOf(BYTES));
  });

  it('F-2108 AC-17: a path that starts with ~/ is shown, stored and run expanded against the home folder', async () => {
    const scene = new Scene();
    const expanded = `${HOME}/bin/renew.sh`;
    scene.files.set(expanded, BYTES);
    scene.present.add(expanded);
    scene.answers = ['allowAlways'];
    await scene.execute('~/bin/renew.sh');
    deepStrictEqual(
      [
        scene.asked[0]?.path,
        [...scene.stored.keys()],
        scene.spawned[0]?.program,
      ],
      [expanded, [expanded], expanded],
    );
  });

  it('F-2108 AC-18: a relative path that does not exist fails as not found and is named as written', async () => {
    const scene = new Scene();
    const result = await scene.execute('missing.sh');
    deepStrictEqual(
      [result, scene.spawned, scene.logged()],
      [
        failedWith('script not found: missing.sh'),
        [],
        failureLines('script not found: missing.sh'),
      ],
    );
  });

  it('F-2108 AC-19, AC-21: a script that exits with a status fails the connect with it, and the log has the output, the error and the summary', async () => {
    const scene = new Scene();
    scene.behaviour = process => {
      process.printLine('about to fail\n');
      process.end(1);
    };
    const result = await scene.execute(SCRIPT);
    deepStrictEqual(
      [result, scene.logged().slice(1)],
      [
        failedWith('non-zero exit code 1'),
        [
          'info: [preconnect] about to fail',
          ...failureLines('non-zero exit code 1'),
        ],
      ],
    );
  });

  it('F-2108 AC-24: a script ended by a signal fails with the signal detail', async () => {
    const scene = new Scene();
    scene.behaviour = process => {
      process.end(undefined);
    };
    deepStrictEqual(
      await scene.execute(SCRIPT),
      failedWith('ended by a signal'),
    );
  });

  it("F-2108 AC-25: a file that cannot be started fails with the system's message", async () => {
    const scene = new Scene();
    scene.spawnError = new Error(`spawn ${SCRIPT} EACCES`);
    deepStrictEqual(
      [await scene.execute(SCRIPT), scene.logged().slice(1)],
      [
        failedWith(`spawn ${SCRIPT} EACCES`),
        failureLines(`spawn ${SCRIPT} EACCES`),
      ],
    );
  });

  it('F-2108 AC-26: a missing absolute path is asked about first, and then fails as not found', async () => {
    const scene = new Scene();
    scene.files.delete(SCRIPT);
    scene.present.delete(SCRIPT);
    deepStrictEqual(
      [await scene.execute(SCRIPT), scene.asked.length],
      [failedWith(`script not found: ${SCRIPT}`), 1],
    );
  });

  it('F-2108 AC-26: the system that cannot examine the path fails with its message', async () => {
    const scene = new Scene();
    const step = preconnectStep({
      setting: () => SCRIPT,
      onRunning: () => undefined,
      prompting: question => question,
      ports: {
        readFile: () => Promise.resolve(BYTES),
        exists: () => Promise.reject(new Error('EACCES: permission denied')),
        spawner: () => Promise.reject(new Error('not reached')),
        environment: {},
        workingDirectory: WORK,
        home: HOME,
        approvals: {
          hashFor: () => undefined,
          remember: () => Promise.resolve(),
        },
        dialog: {askUser: () => Promise.resolve('allow')},
        logger: createLogger(scene.sink, {minimumLevel: (): Level => 'info'}),
      },
    });
    deepStrictEqual(
      await step(INPUT, scene.abort.signal),
      failedWith('EACCES: permission denied'),
    );
  });

  it('F-2108 AC-27: a value that is not a path fails with the reason naming the host and the kind, and no dialog is shown', async () => {
    const scene = new Scene();
    const result = await scene.execute({[ALIAS]: 7});
    deepStrictEqual(
      [result, scene.asked, scene.phases, scene.logged()],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'preconnectFailed',
            reason: {
              id: 'preconnectNotAPath',
              values: [ALIAS, {id: 'preconnectValueNumber', values: []}],
            },
          },
        },
        [],
        ['running'],
        failureLines(
          'The value of remote.SSH.preconnect for "dev" is a number, not the path of a script.',
        ),
      ],
    );
  });

  it("F-2108 AC-35: a stored script that cannot be read fails with the system's message, with no dialog, and the entry stays", async () => {
    const scene = new Scene();
    scene.stored.set(SCRIPT, contentHashOf(BYTES));
    scene.files.set(
      SCRIPT,
      new Error(`ENOENT: no such file or directory, open '${SCRIPT}'`),
    );
    const result = await scene.execute(SCRIPT);
    deepStrictEqual(
      [result, scene.asked, scene.stored.size],
      [
        failedWith(`ENOENT: no such file or directory, open '${SCRIPT}'`),
        [],
        1,
      ],
    );
  });

  it("F-2108 AC-36: Don't Ask Again on a script that cannot be read stores nothing and runs nothing", async () => {
    const scene = new Scene();
    scene.answers = ['allowAlways'];
    scene.files.set(SCRIPT, new Error('EACCES: permission denied'));
    const result = await scene.execute(SCRIPT);
    deepStrictEqual(
      [result, scene.stored.size, scene.spawned.length],
      [failedWith('EACCES: permission denied'), 0, 0],
    );
  });

  it('F-2108 AC-37: a path with a space is shown and run unchanged', async () => {
    const scene = new Scene();
    const spaced = '/my scripts/renew it.sh';
    scene.files.set(spaced, BYTES);
    scene.present.add(spaced);
    await scene.execute(spaced);
    deepStrictEqual(
      [scene.asked[0]?.path, scene.spawned[0]?.program],
      [spaced, spaced],
    );
  });

  it('F-2108 BR-3: a relative path is run from the working directory, not looked up on the search path', async () => {
    const scene = new Scene();
    const resolved = path.resolve(WORK, 'bin/renew.sh');
    scene.files.set('bin/renew.sh', BYTES);
    scene.present.add(resolved);
    await scene.execute('bin/renew.sh');
    deepStrictEqual(scene.spawned[0]?.program, resolved);
  });

  it('F-2108 AC-38: the input is closed at once, so a script that reads gets the end of input', async () => {
    const scene = new Scene();
    let closedAtStart = false;
    scene.behaviour = process => {
      closedAtStart = process.inputEnded;
      process.end(0);
    };
    await scene.execute(SCRIPT);
    deepStrictEqual(closedAtStart, true);
  });

  it('F-2108 AC-42: the connect that stops waiting while the script runs fails without killing it, and a later end changes nothing', async () => {
    const scene = new Scene();
    scene.behaviour = () => undefined;
    const running = scene.execute(SCRIPT);
    await new Promise(resolve => setTimeout(resolve, 5));
    scene.abort.abort();
    const result = await running;
    scene.processes[0]?.end(1);
    deepStrictEqual(
      [result, scene.processes[0]?.killed, scene.logged().slice(1)],
      [
        {kind: 'failed', failure: {kind: 'preconnectFailed'}},
        false,
        [
          'info: the pre-connection step stopped waiting; the script is left to finish',
        ],
      ],
    );
  });

  it('F-2108 AC-42: a connect that stopped waiting before the script was started fails at once, without killing it', async () => {
    const scene = new Scene();
    scene.behaviour = () => undefined;
    scene.abort.abort();
    deepStrictEqual(
      [await scene.execute(SCRIPT), scene.processes[0]?.killed],
      [{kind: 'failed', failure: {kind: 'preconnectFailed'}}, false],
    );
  });

  it('F-2108 AC-42: a connect that stopped waiting while the dialog is open runs nothing when Allow comes later', async () => {
    const scene = new Scene();
    scene.answers = ['aborted'];
    const result = await scene.execute(SCRIPT);
    deepStrictEqual(
      [result, scene.spawned.length, scene.logged()],
      [{kind: 'failed', failure: {kind: 'preconnectFailed'}}, 0, []],
    );
  });

  it('F-2108 AC-33: the alias of a typed user@host:port is the host alone (BR-2)', async () => {
    const scene = new Scene();
    const result = await scene.execute(
      {boxhost: SCRIPT},
      {...INPUT, target: {kind: 'plain', text: 'alex@boxhost:2222'}},
    );
    deepStrictEqual([result, scene.asked.length], [DONE, 1]);
  });

  it('F-2108 AC-30: a reconnection does not run the step, so it is not failed by it', async () => {
    const {recording, options} = setup();
    const scene = new Scene();
    scene.answers = [];
    const result = await connect(
      {...INPUT, attempt: 2, isReconnection: true},
      steps(recording, {
        preconnect: () =>
          Promise.resolve().then(() => {
            scene.prompts += 1;
            return {
              kind: 'failed' as const,
              failure: {kind: 'preconnectFailed' as const},
            };
          }),
      }),
      options,
    );
    deepStrictEqual(['connected' in result, scene.prompts], [true, 0]);
  });
});
