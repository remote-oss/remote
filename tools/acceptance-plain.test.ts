import {deepStrictEqual, doesNotThrow, strictEqual} from 'node:assert';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {
  editorArguments,
  launchFiles,
  packageWindowAgent,
  type PlainSteps,
  plainEditorOf,
  plainTestsOf,
  type Program,
  runPlainLaunch,
  startDetached,
} from './acceptance-plain.ts';
import {type PlainLaunch} from './acceptance-launches.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const LAUNCH: PlainLaunch = {label: 'windows', kind: 'plain', suite: 'windows'};

describe('the editor arguments of a run', () => {
  it('D-85: they name the run’s own user-data and extensions folders', () => {
    deepStrictEqual(editorArguments('/run').slice(0, 2), [
      '--user-data-dir=/run/user-data',
      '--extensions-dir=/run/extensions',
    ]);
  });

  it('D-85: they enable the proposed API of remote-ssh and skip the trust prompt', () => {
    deepStrictEqual(editorArguments('/run').slice(2), [
      '--enable-proposed-api=remote-oss.remote-ssh',
      '--disable-workspace-trust',
    ]);
  });
});

describe('the files of a launch', () => {
  it('D-85: a launch has a script, a record and a log of its own, named by its label', () => {
    deepStrictEqual(launchFiles('/run', 'windows'), {
      script: '/run/windows-script.json',
      record: '/run/windows-record.jsonl',
      logFile: '/run/windows-log.txt',
    });
  });
});

describe('the plain editor of a launch', () => {
  it('D-85: it starts a new window with no folder when the launch has none', () => {
    deepStrictEqual(
      plainEditorOf('/editor', '/run', LAUNCH, {}).programArguments.slice(-1),
      ['--new-window'],
    );
  });

  it('D-85: it opens the launch’s folder when it has one', () => {
    deepStrictEqual(
      plainEditorOf(
        '/editor',
        '/run',
        {...LAUNCH, folderUri: 'file:///x'},
        {},
      ).programArguments.slice(-2),
      ['--folder-uri', 'file:///x'],
    );
  });

  it('D-85: it is the editor’s own program, not a Node.js', () => {
    strictEqual(
      plainEditorOf('/editor', '/run', LAUNCH, {
        ELECTRON_RUN_AS_NODE: '1',
      }).environment.ELECTRON_RUN_AS_NODE,
      undefined,
    );
  });

  it('F-3903 §5 rule 4: the proposed API is enabled for the extension under test by default', () => {
    deepStrictEqual(
      plainEditorOf('/editor', '/run', LAUNCH, {}).programArguments.filter(
        argument => argument.startsWith('--enable-proposed-api'),
      ),
      ['--enable-proposed-api=remote-oss.remote-ssh'],
    );
  });

  it('F-3903 §5 rule 4: a launch with proposedApi false starts the editor without it', () => {
    deepStrictEqual(
      plainEditorOf(
        '/editor',
        '/run',
        {...LAUNCH, proposedApi: false},
        {},
      ).programArguments.filter(argument =>
        argument.startsWith('--enable-proposed-api'),
      ),
      [],
    );
  });

  it("F-3903 §5 rule 4: a launch with proposedApi false keeps the run's folders", () => {
    deepStrictEqual(
      plainEditorOf(
        '/editor',
        '/run',
        {...LAUNCH, proposedApi: false},
        {},
      ).programArguments.slice(0, 2),
      ['--user-data-dir=/run/user-data', '--extensions-dir=/run/extensions'],
    );
  });

  it('D-85: it starts the program it was given', () => {
    strictEqual(plainEditorOf('/editor', '/run', LAUNCH, {}).file, '/editor');
  });
});

describe('the Node tests of a plain launch', () => {
  it('D-85: they run the test files of the launch’s suite folder with mocha, without the repository’s config', () => {
    const program = plainTestsOf('/repo', LAUNCH, {});
    deepStrictEqual(program.programArguments.slice(1), [
      '--no-config',
      '--extension',
      'ts',
      '--spec',
      path.join('/repo', 'tests', 'acceptance', 'windows', '*.test.ts'),
    ]);
  });

  it('D-85: they run in the Node.js that runs the harness', () => {
    strictEqual(plainTestsOf('/repo', LAUNCH, {}).file, process.execPath);
  });

  it('D-85: they get the environment they were given', () => {
    deepStrictEqual(
      plainTestsOf('/repo', LAUNCH, {EXTRA_VARIABLE: '1'}).environment,
      {
        EXTRA_VARIABLE: '1',
      },
    );
  });
});

describe('runPlainLaunch', () => {
  const PLAIN_RUN = {
    runFolder: '/run',
    executable: '/editor',
    environment: {HARNESS_RUN_FOLDER: '/run'},
  };

  /** Steps that record what happened, with tests that end as `outcome` says. */
  function recordingSteps(outcome: 'pass' | 'fail' | 'throw') {
    const happened: string[] = [];
    const programs: Program[] = [];
    const steps: PlainSteps = {
      start: program => {
        happened.push('start');
        programs.push(program);
        return {
          stop: () => {
            happened.push('stop');
          },
        };
      },
      runTests: program => {
        happened.push('tests');
        programs.push(program);
        if (outcome === 'throw') {
          return Promise.reject(new Error('mocha could not start'));
        }
        return Promise.resolve({
          exitCode: outcome === 'pass' ? 0 : 1,
          output: '',
        });
      },
    };
    return {steps, happened, programs};
  }

  it('D-85: it starts the editor, runs the tests, and stops the editor', async () => {
    const {steps, happened} = recordingSteps('pass');
    await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps);
    deepStrictEqual(happened, ['start', 'tests', 'stop']);
  });

  it('D-85: it stops the editor when the tests fail', async () => {
    const {steps, happened} = recordingSteps('fail');
    await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps);
    deepStrictEqual(happened, ['start', 'tests', 'stop']);
  });

  it('D-85: it stops the editor when the tests cannot start', async () => {
    const {steps, happened} = recordingSteps('throw');
    await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps).catch(
      () => undefined,
    );
    deepStrictEqual(happened, ['start', 'tests', 'stop']);
  });

  it('D-85: it returns the exit code of the tests', async () => {
    const {steps} = recordingSteps('fail');
    deepStrictEqual(
      (await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps)).exitCode,
      1,
    );
  });

  it('D-85: the editor and the tests share the launch’s record', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps);
    deepStrictEqual(
      programs.map(program => program.environment.REMOTE_OSS_ACCEPTANCE_RECORD),
      ['/run/windows-record.jsonl', '/run/windows-record.jsonl'],
    );
  });

  it('D-85: a launch’s own environment wins over the run’s', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch(
      '/repo',
      PLAIN_RUN,
      {...LAUNCH, environment: {HARNESS_RUN_FOLDER: '/other'}},
      steps,
    );
    strictEqual(programs[0]?.environment.HARNESS_RUN_FOLDER, '/other');
  });
});

describe('startDetached', () => {
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('acceptance-plain');
  });

  afterEach(() => {
    workspace.remove();
  });

  /** A program that appends a byte to the file every 30 ms. */
  function writer(file: string): Program {
    return {
      file: process.execPath,
      programArguments: [
        '-e',
        `setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(file)}, 'x'), 30)`,
      ],
      environment: {},
    };
  }

  /** Waits the given number of milliseconds. */
  function pause(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  it('D-85: a started program runs until it is stopped', async () => {
    const file = path.join(workspace.root, 'ticks');
    const started = startDetached(writer(file));
    await pause(400);
    started.stop();
    strictEqual(existsSync(file), true);
  });

  it('D-85: stopping a program ends it', async () => {
    const file = path.join(workspace.root, 'ticks');
    const started = startDetached(writer(file));
    await pause(400);
    started.stop();
    await pause(200);
    const before = statSync(file).size;
    await pause(300);
    strictEqual(statSync(file).size, before);
  });

  it('D-85: a program that cannot start is not an error, and stopping it signals nothing', () => {
    const started = startDetached({
      file: path.join(workspace.root, 'no-such-program'),
      programArguments: [],
      environment: {},
    });
    doesNotThrow(() => {
      started.stop();
    });
  });

  it('D-85: stopping a program twice is harmless', async () => {
    const started = startDetached(writer(path.join(workspace.root, 'ticks')));
    await pause(200);
    started.stop();
    await pause(200);
    doesNotThrow(() => {
      started.stop();
    });
  });
});

describe('packageWindowAgent', () => {
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('acceptance-plain');
  });

  afterEach(() => {
    workspace.remove();
  });

  it('D-85: it packages the agent into a VSIX in the run’s folder', async () => {
    const vsix = await packageWindowAgent(REPOSITORY_ROOT, workspace.root);
    deepStrictEqual(
      [vsix, existsSync(vsix)],
      [path.join(workspace.root, 'window-agent.vsix'), true],
    );
  });
});
