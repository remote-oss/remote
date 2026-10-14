import {deepStrictEqual, doesNotThrow, strictEqual} from 'node:assert';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {
  debuggingPortFile,
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
import {launchesOf, type PlainLaunch} from './acceptance-launches.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const LAUNCH: PlainLaunch = {label: 'windows', kind: 'plain', suite: 'windows'};

describe('the editor arguments of a run', () => {
  it('D-85, tooling-33: they name the run’s own user-data, shared-data and extensions folders', () => {
    deepStrictEqual(editorArguments('/run').slice(0, 3), [
      '--user-data-dir=/run/user-data',
      '--shared-data-dir=/run/shared-data',
      '--extensions-dir=/run/extensions',
    ]);
  });

  it('tooling-33: every launch, runner or plain, keeps core’s shared data in the run’s folder', () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    deepStrictEqual(
      [undefined, ...launches].filter(
        launch =>
          !editorArguments('/run', true, launch).includes(
            '--shared-data-dir=/run/shared-data',
          ),
      ),
      [],
    );
  });

  it('D-85: they enable the proposed API of remote-ssh and of the window agent, and skip the trust prompt', () => {
    deepStrictEqual(editorArguments('/run').slice(3), [
      '--enable-proposed-api=remote-oss.remote-ssh',
      '--enable-proposed-api=remote-oss.acceptance-window-agent',
      '--disable-workspace-trust',
    ]);
  });
});

describe('the explorer and trust launches (cards tooling-30, tooling-33)', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  function launchNamed(label: string): PlainLaunch {
    const found = launches.find(launch => launch.label === label);
    if (found?.kind !== 'plain') {
      throw new Error(`no plain launch ${label}`);
    }
    return found;
  }

  it('tooling-30: a launch without extensions of its own uses the run’s folder and the run’s two proposals only', () => {
    deepStrictEqual(
      [
        editorArguments('/run', true),
        editorArguments('/run', true, launchNamed('windows')),
      ].map(list =>
        list.filter(
          argument =>
            argument.startsWith('--extensions-dir') ||
            argument.startsWith('--enable-proposed-api'),
        ),
      ),
      [
        [
          '--extensions-dir=/run/extensions',
          '--enable-proposed-api=remote-oss.remote-ssh',
          '--enable-proposed-api=remote-oss.acceptance-window-agent',
        ],
        [
          '--extensions-dir=/run/extensions',
          '--enable-proposed-api=remote-oss.remote-ssh',
          '--enable-proposed-api=remote-oss.acceptance-window-agent',
        ],
      ],
    );
  });

  it('tooling-30: the explorer launch has its own extensions folder and the explorer’s proposal after the run’s two', () => {
    deepStrictEqual(
      editorArguments('/run', true, launchNamed('explorer')).filter(
        argument =>
          argument.startsWith('--extensions-dir') ||
          argument.startsWith('--enable-proposed-api'),
      ),
      [
        '--extensions-dir=/run/extensions-explorer',
        '--enable-proposed-api=remote-oss.remote-ssh',
        '--enable-proposed-api=remote-oss.acceptance-window-agent',
        '--enable-proposed-api=remote-oss.remote-explorer',
      ],
    );
  });

  it('tooling-30: the explorer launch without proposals keeps its own folder and enables no proposal', () => {
    deepStrictEqual(
      editorArguments(
        '/run',
        false,
        launchNamed('explorer-no-proposals'),
      ).filter(
        argument =>
          argument.startsWith('--extensions-dir') ||
          argument.startsWith('--enable-proposed-api'),
      ),
      ['--extensions-dir=/run/extensions-explorer-no-proposals'],
    );
  });

  it('tooling-30: explorer-alone starts with a debugging port and remote-ssh disabled, before the new window', () => {
    const programArguments = plainEditorOf(
      '/editor',
      '/run',
      launchNamed('explorer-alone'),
      {},
    ).programArguments;
    deepStrictEqual(
      programArguments.slice(
        editorArguments('/run', true, launchNamed('explorer-alone')).length,
      ),
      [
        '--remote-debugging-port=0',
        '--disable-extension=remote-oss.remote-ssh',
        '--new-window',
      ],
    );
  });

  it('tooling-30: the windows and no-proposals launches get no debugging port and disable nothing', () => {
    deepStrictEqual(
      ['windows', 'no-proposals'].flatMap(label =>
        plainEditorOf(
          '/editor',
          '/run',
          launchNamed(label),
          {},
        ).programArguments.filter(
          argument =>
            argument.startsWith('--remote-debugging-port') ||
            argument.startsWith('--disable-extension'),
        ),
      ),
      [],
    );
  });

  it('tooling-33: a trust launch starts the editor with workspace trust on and a debugging port', () => {
    deepStrictEqual(
      [
        editorArguments('/run', true, launchNamed('trust')).includes(
          '--disable-workspace-trust',
        ),
        ...['trust', 'trust-terminal'].map(label => {
          const programArguments = plainEditorOf(
            '/editor',
            '/run',
            launchNamed(label),
            {},
          ).programArguments;
          return [
            programArguments.includes('--disable-workspace-trust'),
            programArguments.includes('--remote-debugging-port=0'),
          ];
        }),
      ],
      [false, [false, true], [false, true]],
    );
  });

  it('tooling-33: every other launch keeps workspace trust off', () => {
    deepStrictEqual(
      [
        editorArguments('/run'),
        editorArguments('/run', true, launchNamed('windows')),
        editorArguments('/run', true, launchNamed('explorer')),
      ].map(list => list.at(-1)),
      Array.from({length: 3}, () => '--disable-workspace-trust'),
    );
  });

  it('tooling-30: the port file is the user-data folder’s DevToolsActivePort', () => {
    strictEqual(
      debuggingPortFile('/run'),
      path.join('/run', 'user-data', 'DevToolsActivePort'),
    );
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
      [
        '--enable-proposed-api=remote-oss.remote-ssh',
        '--enable-proposed-api=remote-oss.acceptance-window-agent',
      ],
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
      ).programArguments.slice(0, 3),
      [
        '--user-data-dir=/run/user-data',
        '--shared-data-dir=/run/shared-data',
        '--extensions-dir=/run/extensions',
      ],
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

  it('tooling-30: it removes a port file an earlier launch left before it starts the editor', async () => {
    const workspace = new TemporaryWorkspace('acceptance-port');
    try {
      workspace.write('user-data/DevToolsActivePort', '9222\n/devtools');
      const {steps} = recordingSteps('pass');
      const seen: boolean[] = [];
      await runPlainLaunch(
        '/repo',
        {...PLAIN_RUN, runFolder: workspace.root},
        LAUNCH,
        {
          ...steps,
          start: program => {
            seen.push(existsSync(debuggingPortFile(workspace.root)));
            return steps.start(program);
          },
        },
      );
      deepStrictEqual(seen, [false]);
    } finally {
      workspace.remove();
    }
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

  it('D-85: the editor and the tests point their windows at the launch’s agent folder', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps);
    deepStrictEqual(
      programs.map(
        program => program.environment.REMOTE_OSS_ACCEPTANCE_WINDOWS,
      ),
      ['/run/windows/agent/pids', '/run/windows/agent/pids'],
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
