import {deepStrictEqual, doesNotThrow, strictEqual, throws} from 'node:assert';
import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {
  debuggingPortFile,
  editorArguments,
  editorLogsEnvironment,
  extensionsFolderOf,
  launchFiles,
  packageWindowAgent,
  type PlainSteps,
  plainEditorOf,
  plainTestsOf,
  type Program,
  runPlainLaunch,
  startDetached,
  stateFolderOf,
  userDataFolderOf,
  writeStandIns,
} from './acceptance-plain.ts';
import {
  launchesOf,
  launchLabelled,
  type PlainLaunch,
} from './acceptance-launches.ts';
import {acceptanceRunId} from './acceptance-run.ts';
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
      '--disable-crash-reporter',
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

  it('tooling-87: only a launch with a locale starts the editor in that display language', () => {
    deepStrictEqual(
      ['windows', 'extensionpack', 'extensionpack-german'].map(label =>
        editorArguments('/run', true, launchNamed(label)).filter(argument =>
          argument.startsWith('--locale'),
        ),
      ),
      [[], [], ['--locale=de']],
    );
  });

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
      ].map(list => list.includes('--disable-workspace-trust')),
      [true, true, true],
    );
  });

  it('tooling-30, tooling-66: the port file is the DevToolsActivePort of the launch’s own user-data folder', () => {
    strictEqual(
      debuggingPortFile('/run', LAUNCH),
      path.join('/run', 'user-data-windows', 'DevToolsActivePort'),
    );
  });
});

describe('the user-data folder of a launch', () => {
  it('tooling-66: a plain launch has one of its own, named by its label; a runner launch and the installs have the run’s', () => {
    deepStrictEqual(
      [
        userDataFolderOf('/run', LAUNCH),
        userDataFolderOf('/run', {
          label: 'remote',
          runner: 'runner-remote',
          suite: 'suite-remote',
        }),
        userDataFolderOf('/run'),
      ],
      ['/run/user-data-windows', '/run/user-data', '/run/user-data'],
    );
  });

  it('tooling-66: every plain launch’s editor starts on a user-data folder no other launch has, and every runner launch’s on the run’s', () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    const plainCount = launches.filter(
      launch => launch.kind === 'plain',
    ).length;
    const folders = new Set(
      launches.map(launch =>
        editorArguments('/run', true, launch).find(argument =>
          argument.startsWith('--user-data-dir='),
        ),
      ),
    );
    deepStrictEqual(
      [folders.size, folders.has('--user-data-dir=/run/user-data')],
      [plainCount + 1, true],
    );
  });

  it('tooling-66: on a run folder shaped as on the CI runners, every launch’s editor socket path stays under the 107 characters at which the editor warns', () => {
    // With no XDG_RUNTIME_DIR the editor binds its main socket in its user-data folder, named by the first four
    // characters of its version. The run id is one digit longer than the runners' ids are now.
    const runFolder = path.join(
      '/tmp',
      `acceptance-${acceptanceRunId({GITHUB_RUN_ID: '123456789012', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'acceptance-vscodium'}, 0)}-Ab12Cd`,
    );
    deepStrictEqual(
      launchesOf(REPOSITORY_ROOT)
        .filter(
          launch =>
            path.join(userDataFolderOf(runFolder, launch), '1.13-main.sock')
              .length >= 107,
        )
        .map(launch => launch.label),
      [],
    );
  });
});

describe('the files of a launch', () => {
  it('D-85: a launch has a script, a record and a log of its own, named by its label', () => {
    deepStrictEqual(launchFiles('/run', 'windows'), {
      script: '/run/windows-script.json',
      record: '/run/windows-record.jsonl',
      logFile: '/run/windows-log.txt',
      containersLogFile: '/run/windows-containers-log.txt',
    });
  });
});

describe('the state folder of a launch (card tooling-79)', () => {
  it('tooling-79: it is the launch’s own folder in the run’s, and the logs variable follows a launch’s own state folder', () => {
    deepStrictEqual(
      [
        stateFolderOf('/run', 'windows'),
        editorLogsEnvironment('/run/windows/state', undefined),
        editorLogsEnvironment('/run/windows/state', {}),
        editorLogsEnvironment('/run/windows/state', {XDG_STATE_HOME: '/mine'}),
      ],
      [
        '/run/windows/state',
        {
          XDG_STATE_HOME: '/run/windows/state',
          HARNESS_EDITOR_LOGS: '/run/windows/state',
        },
        {
          XDG_STATE_HOME: '/run/windows/state',
          HARNESS_EDITOR_LOGS: '/run/windows/state',
        },
        {XDG_STATE_HOME: '/mine', HARNESS_EDITOR_LOGS: '/mine'},
      ],
    );
  });
});

describe('the extensions folder of a launch', () => {
  it('tooling-51: the genuine launch has a folder of its own, and a launch with no extensions of its own has the run’s', () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    deepStrictEqual(
      ['genuine', 'windows'].map(label =>
        extensionsFolderOf(
          '/run',
          launches.find(launch => launch.label === label),
        ),
      ),
      [
        path.join('/run', 'extensions-genuine'),
        path.join('/run', 'extensions'),
      ],
    );
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

  it('F-3903 §5 rule 4: a launch with proposedApi false keeps its folders', () => {
    deepStrictEqual(
      plainEditorOf(
        '/editor',
        '/run',
        {...LAUNCH, proposedApi: false},
        {},
      ).programArguments.slice(0, 3),
      [
        '--user-data-dir=/run/user-data-windows',
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
            return Promise.resolve();
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

  it("tooling-66: the launch's editor and tests are given its own user-data folder", async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps);
    deepStrictEqual(
      programs.map(program => program.environment.HARNESS_USER_DATA),
      ['/run/user-data-windows', '/run/user-data-windows'],
    );
  });

  it("tooling-79: each launch's editor and tests get a state folder of their own in the run's, and HARNESS_EDITOR_LOGS names it", async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, steps);
    deepStrictEqual(
      programs.map(program => [
        program.environment.XDG_STATE_HOME,
        program.environment.HARNESS_EDITOR_LOGS,
      ]),
      [
        ['/run/windows/state', '/run/windows/state'],
        ['/run/windows/state', '/run/windows/state'],
      ],
    );
  });

  it("tooling-79: a launch's own XDG_STATE_HOME wins, as config-files has one, and HARNESS_EDITOR_LOGS is that one", async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch(
      '/repo',
      PLAIN_RUN,
      {...LAUNCH, environment: {XDG_STATE_HOME: '<run>/xdg/state'}},
      steps,
    );
    deepStrictEqual(
      programs.map(program => [
        program.environment.XDG_STATE_HOME,
        program.environment.HARNESS_EDITOR_LOGS,
      ]),
      [
        ['/run/xdg/state', '/run/xdg/state'],
        ['/run/xdg/state', '/run/xdg/state'],
      ],
    );
  });

  it('tooling-30: it removes a port file an earlier attempt left before it starts the editor', async () => {
    const workspace = new TemporaryWorkspace('acceptance-port');
    try {
      workspace.write(
        'user-data-windows/DevToolsActivePort',
        '9222\n/devtools',
      );
      const {steps} = recordingSteps('pass');
      const seen: boolean[] = [];
      await runPlainLaunch(
        '/repo',
        {...PLAIN_RUN, runFolder: workspace.root},
        LAUNCH,
        {
          ...steps,
          start: program => {
            seen.push(existsSync(debuggingPortFile(workspace.root, LAUNCH)));
            return steps.start(program);
          },
        },
      );
      deepStrictEqual(seen, [false]);
    } finally {
      workspace.remove();
    }
  });

  it('tooling-51: the launch ends only once the editor has stopped, so the next launch never meets it', async () => {
    const {steps, happened} = recordingSteps('pass');
    let release: (() => void) | undefined;
    const launching = runPlainLaunch('/repo', PLAIN_RUN, LAUNCH, {
      ...steps,
      start: program => {
        steps.start(program);
        return {
          stop: () =>
            new Promise<void>(resolve => {
              release = () => {
                happened.push('stopped');
                resolve();
              };
            }),
        };
      },
    });
    let settled = false;
    void launching.then(() => {
      settled = true;
    });
    while (release === undefined) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    const settledWhileStopping = settled;
    release();
    await launching;
    deepStrictEqual(
      [settledWhileStopping, happened],
      [false, ['start', 'tests', 'stopped']],
    );
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

  it('coverage-25a: each explorer launch points its editor and its tests at its own agent folder', async () => {
    for (const launch of launchesOf(REPOSITORY_ROOT).filter(each =>
      each.label.startsWith('explorer'),
    )) {
      const {steps, programs} = recordingSteps('pass');
      await runPlainLaunch('/repo', PLAIN_RUN, launch, steps);
      deepStrictEqual(
        programs.map(
          program => program.environment.REMOTE_OSS_ACCEPTANCE_WINDOWS,
        ),
        [
          path.join('/run', launch.label, 'agent', 'pids'),
          path.join('/run', launch.label, 'agent', 'pids'),
        ],
      );
    }
  });

  it('card containers-37: a launch that installs Dev Containers gets a log file of its own for it, the same for its editor and its tests', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch(
      '/repo',
      PLAIN_RUN,
      {...LAUNCH, withExtensions: ['remote-oss.remote-containers']},
      steps,
    );
    deepStrictEqual(
      programs.map(
        program => program.environment.REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG,
      ),
      ['/run/windows-containers-log.txt', '/run/windows-containers-log.txt'],
    );
  });

  it('card containers-37: a launch that does not install Dev Containers gets no file for its log', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch(
      '/repo',
      PLAIN_RUN,
      {...LAUNCH, withExtensions: ['remote-oss.remote-explorer']},
      steps,
    );
    deepStrictEqual(
      programs.map(
        program => program.environment.REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG,
      ),
      [undefined, undefined],
    );
  });

  it('card containers-37: of the launches of the run, those that install Dev Containers get the variable, and no other does', async () => {
    const seen: Array<[string, boolean]> = [];
    for (const launch of launchesOf(REPOSITORY_ROOT).filter(
      each => each.kind === 'plain',
    )) {
      const {steps, programs} = recordingSteps('pass');
      await runPlainLaunch('/repo', PLAIN_RUN, launch, steps);
      seen.push([
        launch.label,
        programs[0]?.environment.REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG ===
          path.join('/run', `${launch.label}-containers-log.txt`),
      ]);
    }
    deepStrictEqual(
      seen.filter(([, gotFile]) => gotFile).map(([label]) => label),
      launchesOf(REPOSITORY_ROOT)
        .filter(
          each =>
            each.kind === 'plain' &&
            (each.withExtensions ?? []).includes(
              'remote-oss.remote-containers',
            ),
        )
        .map(each => each.label),
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

  it('coverage-20: a launch’s environment resolves the run’s tokens for its editor and its tests', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch(
      '/repo',
      PLAIN_RUN,
      {...LAUNCH, environment: {HOME: '<run>/home'}},
      steps,
    );
    deepStrictEqual(
      programs.map(program => program.environment.HOME),
      ['/run/home', '/run/home'],
    );
  });

  it('containers-80: a launch’s environment resolves the run’s download bases, so it can name the host’s paths, and leaves other placeholders as written', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch(
      '/repo',
      {
        ...PLAIN_RUN,
        environment: {
          HARNESS_RUN_FOLDER: '/run',
          HARNESS_DOWNLOADS_LOCAL: 'http://localhost:9',
        },
      },
      {
        ...LAUNCH,
        environment: {
          INDEX: '${HARNESS_DOWNLOADS_LOCAL}/templates/unreachable',
          OTHER: '${localEnv:HOME}',
        },
      },
      steps,
    );
    deepStrictEqual(
      programs.map(program => [
        program.environment.INDEX,
        program.environment.OTHER,
      ]),
      [
        ['http://localhost:9/templates/unreachable', '${localEnv:HOME}'],
        ['http://localhost:9/templates/unreachable', '${localEnv:HOME}'],
      ],
    );
  });

  it('tooling-69: a genuine launch’s tests get the version the job named as the editor version, and any other launch keeps the recorded one', async () => {
    const seen: Array<string | undefined> = [];
    for (const label of ['genuine', 'windows']) {
      const {steps, programs} = recordingSteps('pass');
      await runPlainLaunch(
        '/repo',
        {
          ...PLAIN_RUN,
          environment: {
            ...PLAIN_RUN.environment,
            HARNESS_EDITOR_VERSION: '1.139.1',
            HARNESS_GENUINE_VERSION: '1.125.0',
          },
        },
        launchLabelled(launchesOf(REPOSITORY_ROOT), label),
        steps,
      );
      seen.push(programs[1]?.environment.HARNESS_EDITOR_VERSION);
    }
    deepStrictEqual(seen, ['1.125.0', '1.139.1']);
  });

  const GENUINE = launchLabelled(launchesOf(REPOSITORY_ROOT), 'genuine');

  it('tooling-73: every editor the run starts, genuine VS Code and VSCodium, plain or under the runner, has its crash reporter off', () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    deepStrictEqual(
      [undefined, ...launches]
        .filter(
          launch =>
            !editorArguments('/run', true, launch).includes(
              '--disable-crash-reporter',
            ),
        )
        .map(launch => launch?.label),
      [],
    );
  });

  it('tooling-51: the genuine launch’s editor is the executable given, and its editor and tests get the empty script and the executable that was started', async () => {
    const {steps, programs} = recordingSteps('pass');
    await runPlainLaunch(
      '/repo',
      {
        runFolder: '/run',
        executable: '/vscode/code',
        environment: {HARNESS_RUN_FOLDER: '/run'},
      },
      GENUINE,
      steps,
    );
    deepStrictEqual(
      [
        programs[0]?.file,
        ...programs.map(program => [
          program.environment.REMOTE_OSS_ACCEPTANCE_SCRIPT,
          program.environment.HARNESS_EDITOR_EXECUTABLE,
        ]),
      ],
      ['/vscode/code', ['', '/vscode/code'], ['', '/vscode/code']],
    );
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
    await started.stop();
    strictEqual(existsSync(file), true);
  });

  it('D-85: stopping a program ends it', async () => {
    const file = path.join(workspace.root, 'ticks');
    const started = startDetached(writer(file));
    await pause(400);
    await started.stop();
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
      void started.stop();
    });
  });

  it('D-85: stopping a program twice is harmless', async () => {
    const started = startDetached(writer(path.join(workspace.root, 'ticks')));
    await pause(200);
    await started.stop();
    await started.stop();
  });

  /**
   * A program whose child, in its group, writes each signal it gets to `file` after its own pid; the program writes
   * `exited` there when SIGTERM ends it.
   */
  function family(file: string, programIgnoresTerm = false): Program {
    const childScript = [
      "const fs = require('node:fs');",
      `const file = ${JSON.stringify(file)};`,
      "fs.appendFileSync(file, 'child ' + process.pid + '\\n');",
      "for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) { process.on(name, () => fs.appendFileSync(file, name + '\\n')); }",
      'setInterval(() => undefined, 1000);',
    ].join(' ');
    return {
      file: process.execPath,
      programArguments: [
        '-e',
        [
          "const fs = require('node:fs');",
          `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio: 'ignore'});`,
          programIgnoresTerm
            ? "process.on('SIGTERM', () => undefined);"
            : `process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(file)}, 'exited\\n'); process.exit(0); });`,
          'setInterval(() => undefined, 1000);',
        ].join(' '),
      ],
      environment: {},
    };
  }

  /** The lines `family` wrote, once its child has started. */
  async function linesOnceStarted(file: string): Promise<string[]> {
    while (
      !existsSync(file) ||
      !readFileSync(file, 'utf8').includes('child ')
    ) {
      await pause(20);
    }
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => line !== '');
  }

  /** Whether the process `processId` still runs: a zombie waiting for a parent to reap it doesn't. */
  function alive(processId: number): boolean {
    try {
      return !/^\d+ \(.*\) Z /.test(
        readFileSync(`/proc/${String(processId)}/stat`, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  const QUICK = {
    graceMilliseconds: 400,
    afterKillMilliseconds: 400,
    pollMilliseconds: 20,
    groupAlive: (groupId: number) => {
      try {
        process.kill(-groupId, 0);
        return true;
      } catch {
        return false;
      }
    },
  };

  it('tooling-51: SIGTERM goes to the program alone, never to its group, and stop waits until the group has ended', async () => {
    const file = path.join(workspace.root, 'signals');
    const started = startDetached(family(file), QUICK);
    const child = Number((await linesOnceStarted(file))[0]?.split(' ')[1]);
    await started.stop();
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => line !== '');
    deepStrictEqual([lines.slice(1), alive(child)], [['exited'], false]);
  });

  it('tooling-51: a program that ignores SIGTERM has its group killed once the grace has passed, and not before', async () => {
    const file = path.join(workspace.root, 'signals');
    const started = startDetached(family(file, true), QUICK);
    const child = Number((await linesOnceStarted(file))[0]?.split(' ')[1]);
    const began = Date.now();
    await started.stop();
    const took = Date.now() - began;
    deepStrictEqual(
      [alive(child), took >= 400, took < 3000],
      [false, true, true],
    );
  });

  it('tooling-51: a group still there after SIGKILL ends the wait after its bound, with a line on stderr', async () => {
    const started = startDetached(writer(path.join(workspace.root, 'ticks')), {
      ...QUICK,
      groupAlive: () => true,
    });
    await pause(100);
    const written: string[] = [];
    const original = console.error;
    console.error = (message: unknown) => {
      written.push(String(message));
    };
    const began = Date.now();
    try {
      await started.stop();
    } finally {
      console.error = original;
    }
    deepStrictEqual(
      [
        Date.now() - began < 3000,
        written.length,
        written[0]?.includes('still there after SIGKILL'),
      ],
      [true, 1, true],
    );
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

describe('the stand-ins of a launch (card containers-09)', () => {
  const STAND_IN: PlainLaunch = {
    label: 'standing',
    kind: 'plain',
    suite: 'standing',
    withExtensions: ['remote-oss.remote-containers'],
    standIns: ['ms-vscode-remote.remote-containers'],
  };
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('stand-ins');
  });

  afterEach(() => {
    workspace.remove();
  });

  it('containers-09: a launch without stand-ins writes nothing', () => {
    writeStandIns(
      workspace.root,
      {label: 'plain', kind: 'plain', suite: 'plain'},
      '^1.139.0',
    );
    strictEqual(existsSync(path.join(workspace.root, 'extensions')), false);
  });

  it('containers-09: an extensions folder whose list names no extension fails, naming the file', () => {
    workspace.write('extensions-standing/extensions.json', []);
    throws(
      () => {
        writeStandIns(workspace.root, STAND_IN, '^1.139.0');
      },
      {
        message: `${path.join(workspace.root, 'extensions-standing', 'extensions.json')} lists no extension to copy a stand-in's entry from`,
      },
    );
  });
});
