import {
  deepStrictEqual,
  notStrictEqual,
  rejects,
  strictEqual,
  throws,
} from 'node:assert';
import {createHash} from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  acceptanceConfiguration,
  type AttemptResult,
  bundleSuite,
  downloadWithRetry,
  editorChoiceOf,
  type CommandResult,
  failureText,
  harnessSshConfig,
  type HarnessDependencies,
  type HarnessVariables,
  mappedPort,
  packagedExtensions,
  removeBundles,
  RETRY_PAUSE_MILLISECONDS,
  runAcceptance,
  runCommand,
  runLaunches,
  runTestCli,
  unpackArchive,
  USAGE,
  VSCODIUM_RELEASE,
  vscodiumConfiguration,
  vscodiumConfigurations,
  vscodiumExecutableOf,
  withOneRetry,
  writeUserSettings,
} from './acceptance.ts';
import {failureCases, type Launch} from './acceptance-launches.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const CONTAINER = 'c0ffee';

/** A harness whose commands succeed, recording each call; `answers` overrides the result of a program. */
class FakeHarness implements HarnessDependencies {
  readonly calls: string[] = [];
  readonly sleeps: number[] = [];
  variables: HarnessVariables | undefined;
  runFolder = '';
  sshFailures = 0;
  bundleSuiteError: Error | undefined;
  testResult: AttemptResult = {exitCode: 0, output: ''};
  readonly labelResults = new Map<string, AttemptResult>();
  readonly launched: Array<string | undefined> = [];
  /** The files of the run's folder as the first launch found them, by name. */
  readonly firstLaunchFiles = new Map<string, string>();
  readonly answers = new Map<string, CommandResult>();

  readonly command = (
    program: string,
    programArguments: readonly string[],
  ): CommandResult => {
    this.calls.push([program, ...programArguments].join(' '));
    const answer = this.answers.get(`${program} ${programArguments[0] ?? ''}`);
    if (answer !== undefined) {
      return answer;
    }
    if (program === 'ssh-keygen') {
      const keyFile = programArguments.at(-1) ?? '';
      this.runFolder = path.dirname(keyFile);
      writeFileSync(`${keyFile}.pub`, 'ssh-ed25519 AAAA acceptance\n');
    }
    if (program === 'ssh' && this.sshFailures > 0) {
      this.sshFailures -= 1;
      return {status: 255, stdout: '', stderr: 'Connection refused'};
    }
    const stdout =
      programArguments[0] === 'run'
        ? `${CONTAINER}\n`
        : programArguments[0] === 'port'
          ? '127.0.0.1:49153\n'
          : '';
    return {status: 0, stdout, stderr: ''};
  };

  readonly sleep = (milliseconds: number): Promise<void> => {
    this.sleeps.push(milliseconds);
    return Promise.resolve();
  };

  readonly bundleSuite = (): Promise<void> => {
    this.calls.push('bundle suite');
    if (this.bundleSuiteError !== undefined) {
      return Promise.reject(this.bundleSuiteError);
    }
    return Promise.resolve();
  };

  readonly editorCli = (): Promise<string> => Promise.resolve('code');

  readonly vscodiumExecutable = (): Promise<string> => {
    this.calls.push('vscodium executable');
    return Promise.resolve('codium-insiders');
  };

  readonly runTests = (
    root: string,
    variables: HarnessVariables,
    label?: string,
  ): Promise<AttemptResult> => {
    this.variables = variables;
    if (this.launched.length === 0) {
      for (const name of readdirSync(variables.HARNESS_RUN_FOLDER).filter(
        entry =>
          statSync(path.join(variables.HARNESS_RUN_FOLDER, entry)).isFile(),
      )) {
        this.firstLaunchFiles.set(
          name,
          readFileSync(path.join(variables.HARNESS_RUN_FOLDER, name), 'utf8'),
        );
      }
    }
    this.launched.push(label);
    return Promise.resolve(
      this.labelResults.get(label ?? '') ?? this.testResult,
    );
  };
}

/** The sleeper and reporter of the retry rows, recording their calls. */
class RetryRecorder {
  readonly sleeps: number[] = [];
  readonly lines: string[] = [];

  readonly sleep = (milliseconds: number): Promise<void> => {
    this.sleeps.push(milliseconds);
    return Promise.resolve();
  };

  readonly report = (line: string): void => {
    this.lines.push(line);
  };
}

/** Steps a list of outcomes one per call, repeating the last, and counts the calls. */
function scriptedStep(outcomes: unknown[]) {
  let calls = 0;

  function step(): Promise<unknown> {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }
    return Promise.resolve(outcome);
  }

  function called(): number {
    return calls;
  }
  return {step, called};
}

const FAILURE = {
  alias: 'refused',
  cite: 'F-2601 AC-1',
  script: [{surface: 'failureDialog', match: 'refused', answer: 'dismiss'}],
  dialog: 'Could not establish connection to "refused".',
};

describe('acceptance', () => {
  let workspace: TemporaryWorkspace;
  let harness: FakeHarness;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('acceptance');
    harness = new FakeHarness();
    workspace.write(
      'tests/acceptance/suite-failure/cases.json',
      JSON.stringify({cases: [FAILURE]}),
    );
  });

  afterEach(() => {
    workspace.remove();
  });

  describe('mappedPort', () => {
    it('reads the host port of a docker port line', () => {
      strictEqual(mappedPort('127.0.0.1:49153\n'), 49153);
    });

    it('fails when the output names no port', () => {
      throws(() => mappedPort('\n'), {message: "no mapped port in ''"});
    });
  });

  it('writes Host harness with the run key, its own known hosts and no agent', () => {
    strictEqual(
      harnessSshConfig(49153, '/run').split('\n\n')[0],
      [
        'Host harness',
        '  HostName 127.0.0.1',
        '  Port 49153',
        '  User harness',
        '  IdentityFile /run/id_ed25519',
        '  IdentitiesOnly yes',
        '  IdentityAgent none',
        '  StrictHostKeyChecking accept-new',
        '  BatchMode yes',
        '  ConnectTimeout 10',
        '  UserKnownHostsFile /run/known_hosts',
      ].join('\n'),
    );
  });

  it('F-2601 AC-1: Host refused points at a closed port of the loopback', () => {
    strictEqual(
      harnessSshConfig(49153, '/run').split('\n\n')[1],
      [
        'Host refused',
        '  HostName 127.0.0.1',
        '  Port 9',
        '  BatchMode yes',
      ].join('\n'),
    );
  });

  it('F-2601 AC-3: Host nowhere names a host that never resolves', () => {
    strictEqual(
      harnessSshConfig(49153, '/run').split('\n\n')[2],
      ['Host nowhere', '  HostName nowhere.invalid', '  BatchMode yes'].join(
        '\n',
      ),
    );
  });

  it('F-2601 AC-6: Host stranger is the harness host with its own empty known hosts, and asks', () => {
    strictEqual(
      harnessSshConfig(49153, '/run').split('\n\n')[3],
      [
        'Host stranger',
        '  HostName 127.0.0.1',
        '  Port 49153',
        '  User harness',
        '  IdentityFile /run/id_ed25519',
        '  IdentitiesOnly yes',
        '  IdentityAgent none',
        '  StrictHostKeyChecking ask',
        '  UserKnownHostsFile /run/known_hosts_stranger',
        '',
      ].join('\n'),
    );
  });

  it("gives the editor's user settings the harness ssh_config as remote.SSH.configFile", () => {
    writeUserSettings(workspace.root, '/run/ssh_config');
    deepStrictEqual(
      JSON.parse(
        readFileSync(
          path.join(workspace.root, 'user-data', 'User', 'settings.json'),
          'utf8',
        ),
      ),
      {'remote.SSH.configFile': '/run/ssh_config'},
    );
  });

  describe('packagedExtensions', () => {
    it('finds the VSIX of each extension under test and no other', () => {
      workspace.write('dist/remote-ssh-0.0.0.vsix', '');
      workspace.write('dist/remote-ssh-edit-0.0.0.vsix', '');
      workspace.write('dist/remote-wsl-0.0.0.vsix', '');
      deepStrictEqual(packagedExtensions(workspace.root), [
        path.join(workspace.root, 'dist', 'remote-ssh-0.0.0.vsix'),
        path.join(workspace.root, 'dist', 'remote-ssh-edit-0.0.0.vsix'),
      ]);
    });

    it('finds none before anything is packaged', () => {
      deepStrictEqual(packagedExtensions(workspace.root), []);
    });
  });

  describe('runAcceptance', () => {
    it('#439: the run removes the suite bundles when it ends', async () => {
      workspace.write('tests/acceptance/dist-remote/window.test.cjs', '');
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(
        existsSync(path.join(workspace.root, 'tests/acceptance/dist-remote')),
        false,
      );
    });

    it('builds the host, starts it with the run key, waits for SSH, bundles and runs the tests', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        harness.calls.map(call => call.split(' ').slice(0, 2).join(' ')),
        [
          'docker build',
          'ssh-keygen -q',
          'docker run',
          'docker port',
          'ssh -F',
          'bundle suite',
          `docker rm`,
        ],
      );
    });

    it('passes the harness variables to the tests', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(harness.variables, {
        REMOTE_OSS_ACCEPTANCE: '1',
        HARNESS_SSH_CONFIG: path.join(harness.runFolder, 'ssh_config'),
        HARNESS_CONTAINER: CONTAINER,
        HARNESS_RUN_FOLDER: harness.runFolder,
        REMOTE_OSS_ACCEPTANCE_SCRIPT: path.join(
          harness.runFolder,
          'script.json',
        ),
        REMOTE_OSS_ACCEPTANCE_RECORD: path.join(
          harness.runFolder,
          'record.jsonl',
        ),
        HARNESS_VSIX_FILES: '',
        HARNESS_EDITOR: 'vscode',
      });
    });

    it("installs the packaged VSIX into the run's own extensions folder before the tests", async () => {
      workspace.write('dist/remote-ssh-edit-0.0.0.vsix', '');
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        harness.calls.filter(call => call.startsWith('code ')),
        [
          [
            'code',
            `--extensions-dir=${path.join(harness.runFolder, 'extensions')}`,
            `--user-data-dir=${path.join(harness.runFolder, 'user-data')}`,
            '--install-extension',
            path.join(workspace.root, 'dist', 'remote-ssh-edit-0.0.0.vsix'),
          ].join(' '),
        ],
      );
    });

    it("returns the tests' exit code", async () => {
      harness.testResult = {exitCode: 3, output: ''};
      strictEqual(await runAcceptance(workspace.root, harness), 3);
    });

    it('removes the container and the run folder after the tests', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [harness.calls.at(-1), existsSync(harness.runFolder)],
        [`docker rm --force ${CONTAINER}`, false],
      );
    });

    it('retries SSH half a second apart until the host accepts', async () => {
      harness.sshFailures = 2;
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(harness.sleeps, [500, 500]);
    });

    it('fails when the host never accepts SSH, and still removes the container', async () => {
      harness.sshFailures = 40;
      const status = await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [status, harness.calls.at(-1)],
        [1, `docker rm --force ${CONTAINER}`],
      );
    });

    it('fails when the image does not build, with no container to remove', async () => {
      harness.answers.set('docker build', {
        status: 1,
        stdout: '',
        stderr: 'no daemon',
      });
      const status = await runAcceptance(workspace.root, harness);
      deepStrictEqual([status, harness.calls.length], [1, 1]);
    });

    it('prints the cause of an empty error and returns 1', async () => {
      harness.bundleSuiteError = new Error('', {cause: 'no space'});
      const lines: string[] = [];
      const previousError = console.error;
      console.error = (line: unknown) => lines.push(String(line));
      try {
        const status = await runAcceptance(workspace.root, harness);
        deepStrictEqual([status, lines], [1, ['acceptance: no space']]);
      } finally {
        console.error = previousError;
      }
    });
  });

  describe('runLaunches', () => {
    const BASE = {'remote.SSH.configFile': '/run/ssh_config'};
    const TERMINAL: Launch = {
      label: 'terminal',
      runner: 'runner-remote',
      suite: 'suite-terminal',
      settings: {'remote.SSH.useLocalServer': false},
    };
    const REMOTE: Launch = {
      label: 'remote',
      runner: 'runner-remote',
      suite: 'suite-remote',
    };

    /** The editor's user settings file of the run. */
    function settingsPath(): string {
      return path.join(workspace.root, 'user-data', 'User', 'settings.json');
    }

    /** The user settings as the editor would read them now. */
    function settingsFile(): unknown {
      return JSON.parse(readFileSync(settingsPath(), 'utf8'));
    }

    /** The user settings each launch found when it started, by label. */
    async function settingsSeen(
      ...launches: Launch[]
    ): Promise<Map<string, unknown>> {
      const seen = new Map<string, unknown>();
      await runLaunches(workspace.root, '/run/ssh_config', launches, label => {
        seen.set(label ?? '', settingsFile());
        return Promise.resolve({exitCode: 0, output: ''});
      });
      return seen;
    }

    it('D-85: a launch with settings finds them over the base settings', async () => {
      deepStrictEqual((await settingsSeen(TERMINAL, REMOTE)).get('terminal'), {
        ...BASE,
        'remote.SSH.useLocalServer': false,
      });
    });

    it('D-85: the launch after one with settings finds only the base settings', async () => {
      deepStrictEqual(
        (await settingsSeen(TERMINAL, REMOTE)).get('remote'),
        BASE,
      );
    });

    it("D-85: a launch's own remote.SSH.configFile is the one written", async () => {
      const seen = await settingsSeen({
        ...REMOTE,
        settings: {'remote.SSH.configFile': '/elsewhere'},
      });
      deepStrictEqual(seen.get('remote'), {
        'remote.SSH.configFile': '/elsewhere',
      });
    });

    it('D-85: a retried launch finds the base settings again, not what the failed attempt left', async () => {
      const seen: unknown[] = [];
      let attempts = 0;
      await runLaunches(workspace.root, '/run/ssh_config', [TERMINAL], () => {
        attempts += 1;
        seen.push(settingsFile());
        writeFileSync(settingsPath(), '{"left": "behind"}');
        return Promise.resolve({
          exitCode: attempts === 1 ? 1 : 0,
          output: attempts === 1 ? 'CodeWindow: detected unresponsive' : '',
        });
      });
      deepStrictEqual(seen[1], seen[0]);
    });

    it('D-85: the VS Code run starts its one configuration without a label and writes no settings', async () => {
      const labels: Array<string | undefined> = [];
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [undefined],
        label => {
          labels.push(label);
          return Promise.resolve({exitCode: 0, output: ''});
        },
      );
      deepStrictEqual(
        [labels, existsSync(path.join(workspace.root, 'user-data', 'User'))],
        [[undefined], false],
      );
    });
  });

  describe('withOneRetry', () => {
    it('returns the step result without sleeping or reporting when the step resolves', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep(['ok']);
      const result = await withOneRetry(step, recorder.sleep, recorder.report);
      deepStrictEqual(
        [result, recorder.sleeps, recorder.lines],
        ['ok', [], []],
      );
    });

    it('returns the retry result when the first attempt rejects', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), 'ok']);
      const result = await withOneRetry(step, recorder.sleep, recorder.report);
      strictEqual(result, 'ok');
    });

    it('sleeps the retry pause before the one retry', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), 'ok']);
      await withOneRetry(step, recorder.sleep, recorder.report);
      deepStrictEqual(recorder.sleeps, [RETRY_PAUSE_MILLISECONDS]);
    });

    it('reports the failure and the pause in seconds before the one retry', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), 'ok']);
      await withOneRetry(step, recorder.sleep, recorder.report);
      deepStrictEqual(recorder.lines, [
        'acceptance: busy; retrying once in 5 s',
      ]);
    });

    it('rejects with the second error when the retry rejects too', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), new Error('down')]);
      await rejects(
        withOneRetry(step, recorder.sleep, recorder.report),
        /down/,
      );
    });

    it('runs the step once more after a rejection, and no more', async () => {
      const recorder = new RetryRecorder();
      const {step, called} = scriptedStep([
        new Error('busy'),
        new Error('busy'),
      ]);
      let rejected = false;
      try {
        await withOneRetry(step, recorder.sleep, recorder.report);
      } catch {
        rejected = true;
      }
      deepStrictEqual([called(), rejected], [2, true]);
    });
  });

  describe('failureText', () => {
    it('returns the message of an error that has one', () => {
      strictEqual(failureText(new Error('boom')), 'boom');
    });

    it('returns the cause message when the message is empty and the cause is an error', () => {
      strictEqual(
        failureText(new Error('', {cause: new Error('ECONNRESET')})),
        'ECONNRESET',
      );
    });

    it('returns the cause text when the message is empty and the cause is not an error', () => {
      strictEqual(
        failureText(new Error('', {cause: 'socket hang up'})),
        'socket hang up',
      );
    });

    it('returns the first two stack lines, trimmed and joined, for an empty message without a cause', () => {
      const error = new Error('');
      error.stack =
        'Error\n    at a (x.js:1:1)\n    at b (y.js:2:2)\n    at c (z.js:3:3)';
      strictEqual(failureText(error), 'Error at a (x.js:1:1)');
    });

    it('returns the error name when the message is empty and there is no cause or stack', () => {
      const error = new Error('');
      delete error.stack;
      strictEqual(failureText(error), 'Error');
    });

    it('returns the string of a non-error', () => {
      strictEqual(failureText(42), '42');
    });
  });

  describe('acceptanceConfiguration', () => {
    it('runs the floor editor with a fresh profile and the proposed API of the extensions under test', () => {
      const configuration = acceptanceConfiguration('/repo', {
        HARNESS_RUN_FOLDER: '/run',
        HARNESS_VSIX_FILES: '',
      });
      deepStrictEqual(
        [configuration.version, configuration.launchArgs],
        [
          '1.139.1',
          [
            '--user-data-dir=/run/user-data',
            '--extensions-dir=/run/extensions',
            '--enable-proposed-api=remote-oss.remote-ssh',
            '--disable-workspace-trust',
          ],
        ],
      );
    });

    it('passes the harness variables to the extension host', () => {
      strictEqual(
        acceptanceConfiguration('/repo', {HARNESS_CONTAINER: CONTAINER}).env
          .HARNESS_CONTAINER,
        CONTAINER,
      );
    });
  });

  describe('the VSCodium run', () => {
    const EXECUTABLE = '/vscodium/codium-insiders';
    const LAUNCH: Launch = {
      label: 'extra',
      runner: 'runner',
      suite: 'suite-extra',
    };
    const CONFIGURATION_ENVIRONMENT = {HARNESS_RUN_FOLDER: '/run'};

    /** The configurations of the run, from the workspace's failure cases. */
    function configurations() {
      return vscodiumConfigurations(
        workspace.root,
        CONFIGURATION_ENVIRONMENT,
        EXECUTABLE,
      );
    }

    it('#253 Q14: with no editor the VSCodium executable is not asked for, and the VS Code CLI installs the VSIX files', async () => {
      workspace.write('dist/remote-ssh-0.0.0.vsix', '');
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [
          harness.calls.includes('vscodium executable'),
          harness.calls.some(call => call.startsWith('code ')),
        ],
        [false, true],
      );
    });

    it('#253 Q14: the VSIX files are installed with the command-line wrapper in the bin folder beside the executable', async () => {
      workspace.write('dist/remote-ssh-0.0.0.vsix', '');
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        harness.calls
          .filter(call => call.includes('--install-extension'))
          .map(call => call.split(' ')[0]),
        [path.join('bin', 'codium-insiders')],
      );
    });

    it('#253 Q14, rulings 1 and 2: test-cli ran the local label, the remote one, the reconnection and each failing connect', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(harness.launched, [
        'local',
        'remote',
        'reconnect',
        'failure-refused',
        'terminal',
      ]);
    });

    it("ruling 1: a failing connect's script is written before the first launch", async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        JSON.parse(
          harness.firstLaunchFiles.get('failure-refused-script.json') ?? '',
        ),
        {
          entries: FAILURE.script,
        },
      );
    });

    it('ruling 1: a failing connect opens a window on its alias', () => {
      deepStrictEqual(configurations()[3]?.launchArgs.slice(0, 2), [
        '--folder-uri',
        'vscode-remote://ssh-remote+refused/home/harness',
      ]);
    });

    it('ruling 1: a failing connect answers from its own script and record', () => {
      deepStrictEqual(
        [
          configurations()[3]?.env.REMOTE_OSS_ACCEPTANCE_SCRIPT,
          configurations()[3]?.env.REMOTE_OSS_ACCEPTANCE_RECORD,
        ],
        [
          path.join('/run', 'failure-refused-script.json'),
          path.join('/run', 'failure-refused-record.jsonl'),
        ],
      );
    });

    it("ruling 1: the other launches keep the run's script", () => {
      deepStrictEqual(
        configurations()
          .slice(0, 3)
          .map(configuration => configuration.env.REMOTE_OSS_ACCEPTANCE_SCRIPT),
        [undefined, undefined, undefined],
      );
    });

    it('ruling 1: the failing connects come from the cases file', () => {
      deepStrictEqual(failureCases(workspace.root), [FAILURE]);
    });

    it('triton on #439: an alias with a character outside its form is refused', () => {
      workspace.write(
        'tests/acceptance/suite-failure/cases.json',
        JSON.stringify({cases: [{...FAILURE, alias: '../x'}]}),
      );
      throws(() => failureCases(workspace.root), /alias must match/);
    });

    it('triton on #439: an alias that starts with a digit is refused', () => {
      workspace.write(
        'tests/acceptance/suite-failure/cases.json',
        JSON.stringify({cases: [{...FAILURE, alias: '9x'}]}),
      );
      throws(() => failureCases(workspace.root), /alias must match/);
    });

    it('#253 Q14: the harness variables name the editor and its executable', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        [
          harness.variables?.HARNESS_EDITOR,
          harness.variables?.HARNESS_VSCODIUM_EXECUTABLE,
        ],
        ['vscodium', 'codium-insiders'],
      );
    });

    it('#253 Q14: with the local run failing the exit code is non-zero', async () => {
      harness.labelResults.set('local', {exitCode: 3, output: ''});
      strictEqual(await runAcceptance(workspace.root, harness, 'vscodium'), 3);
    });

    it('#253 Q14: with the local run failing the remote ones still ran', async () => {
      harness.labelResults.set('local', {exitCode: 3, output: ''});
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(harness.launched, [
        'local',
        'remote',
        'reconnect',
        'failure-refused',
        'terminal',
      ]);
    });

    it('#253 Q14: with the remote run failing the exit code is non-zero', async () => {
      harness.labelResults.set('remote', {exitCode: 4, output: ''});
      strictEqual(await runAcceptance(workspace.root, harness, 'vscodium'), 4);
    });

    it('#253 Q14: the remote configuration opens the folder on ssh-remote+harness', () => {
      deepStrictEqual(configurations()[1]?.launchArgs.slice(0, 2), [
        '--folder-uri',
        'vscode-remote://ssh-remote+harness/home/harness',
      ]);
    });

    it('#253 Q14: the local configuration opens no folder', () => {
      strictEqual(
        configurations()[0]?.launchArgs.includes('--folder-uri'),
        false,
      );
    });

    it('#253 Q14: every configuration uses the executable', () => {
      deepStrictEqual(
        configurations().map(
          configuration => configuration.useInstallation.fromPath,
        ),
        [EXECUTABLE, EXECUTABLE, EXECUTABLE, EXECUTABLE, EXECUTABLE],
      );
    });

    it('#253 Q14: every configuration enables the proposed API of remote-ssh', () => {
      deepStrictEqual(
        configurations().map(configuration =>
          configuration.launchArgs.includes(
            '--enable-proposed-api=remote-oss.remote-ssh',
          ),
        ),
        [true, true, true, true, true],
      );
    });

    it('#253 Q14: the configurations are labelled and read their own bundles', () => {
      deepStrictEqual(
        configurations().map(configuration => [
          configuration.label,
          configuration.files,
        ]),
        [
          ['local', 'dist-local/**/*.test.cjs'],
          ['remote', 'dist-remote/**/*.test.cjs'],
          ['reconnect', 'dist-reconnect/**/*.test.cjs'],
          ['failure-refused', 'dist-failure/**/*.test.cjs'],
          ['terminal', 'dist-terminal/**/*.test.cjs'],
        ],
      );
    });

    it('D-85: the terminal launch opens the folder on ssh-remote+harness', () => {
      deepStrictEqual(configurations()[4]?.launchArgs.slice(0, 2), [
        '--folder-uri',
        'vscode-remote://ssh-remote+harness/home/harness',
      ]);
    });

    it('D-85: a launch with an environment adds it to the extension host', () => {
      strictEqual(
        vscodiumConfiguration(
          workspace.root,
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
          {...LAUNCH, environment: {EXTRA: '1'}},
        ).env.EXTRA,
        '1',
      );
    });

    it("D-85: a launch's environment wins over the harness variable of the same name", () => {
      strictEqual(
        vscodiumConfiguration(
          workspace.root,
          {...CONFIGURATION_ENVIRONMENT, REMOTE_OSS_ACCEPTANCE_RECORD: 'run'},
          EXECUTABLE,
          {
            ...LAUNCH,
            ownScript: true,
            environment: {REMOTE_OSS_ACCEPTANCE_RECORD: 'launch'},
          },
        ).env.REMOTE_OSS_ACCEPTANCE_RECORD,
        'launch',
      );
    });

    it('D-85: a launch with further extensions loads them after the runner', () => {
      deepStrictEqual(
        vscodiumConfiguration(
          workspace.root,
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
          {...LAUNCH, extraExtensions: ['slow-remote']},
        ).extensionDevelopmentPath,
        [
          path.join(workspace.root, 'tests', 'acceptance', 'runner'),
          path.join(workspace.root, 'tests', 'acceptance', 'slow-remote'),
        ],
      );
    });

    it('D-85: a launch with no environment leaves the harness variables as they are', () => {
      deepStrictEqual(
        vscodiumConfiguration(
          workspace.root,
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
          LAUNCH,
        ).env,
        CONFIGURATION_ENVIRONMENT,
      );
    });

    it('#253 Q14: every remote launch uses the workspace-kind runner', () => {
      deepStrictEqual(
        configurations()
          .slice(1)
          .map(configuration => configuration.extensionDevelopmentPath),
        [1, 2, 3, 4].map(() =>
          path.join(workspace.root, 'tests', 'acceptance', 'runner-remote'),
        ),
      );
    });

    it('#253 ruling 2: the reconnection opens the same folder as the remote launch', () => {
      deepStrictEqual(
        configurations()
          .slice(1, 3)
          .map(configuration => configuration.launchArgs.slice(0, 2)),
        [
          ['--folder-uri', 'vscode-remote://ssh-remote+harness/home/harness'],
          ['--folder-uri', 'vscode-remote://ssh-remote+harness/home/harness'],
        ],
      );
    });

    it('ADR-0007: the pinned release is at or above the engines floor', () => {
      const floor = /(\d+)\.(\d+)/.exec(
        (
          JSON.parse(
            readFileSync(
              path.join(
                REPOSITORY_ROOT,
                'packages',
                'remote-ssh',
                'package.json',
              ),
              'utf8',
            ),
          ) as {engines: {vscode: string}}
        ).engines.vscode,
      );
      const pinned = /^(\d+)\.(\d+)/.exec(
        VSCODIUM_RELEASE.tagName.split('-')[0] ?? '',
      );
      deepStrictEqual(
        Number(pinned?.[1]) * 1000 + Number(pinned?.[2]) >=
          Number(floor?.[1]) * 1000 + Number(floor?.[2]),
        true,
      );
    });

    it('#253 Q14: a download that does not match its checksum throws', async () => {
      await rejects(
        vscodiumExecutableOf(workspace.root, 'linux', 'x64', {
          download: () => Promise.resolve(new Uint8Array([1, 2, 3])),
          unpack: () => undefined,
        }),
        {message: 'the VSCodium download does not match its checksum'},
      );
    });

    it('#253 Q14: a checked download is unpacked and the executable returned', async () => {
      const archive = new Uint8Array([1, 2, 3]);
      const digest = createHash('sha256').update(archive).digest('hex');
      const unpacked: string[] = [];
      const executable = await vscodiumExecutableOf(
        workspace.root,
        'linux',
        'x64',
        {
          download: () => Promise.resolve(archive),
          unpack: (bytes, folder) => {
            unpacked.push(folder);
          },
        },
        {...VSCODIUM_RELEASE.sha256, 'linux-x64': digest},
      );
      deepStrictEqual(
        [executable, unpacked.length],
        [
          path.join(
            workspace.root,
            '.vscode-test',
            `vscodium-${VSCODIUM_RELEASE.tagName}`,
            'codium-insiders',
          ),
          1,
        ],
      );
    });

    it('#253 Q14: a build that is already there is not downloaded again', async () => {
      workspace.write(
        `.vscode-test/vscodium-${VSCODIUM_RELEASE.tagName}/codium-insiders`,
        '',
      );
      let downloads = 0;
      await vscodiumExecutableOf(workspace.root, 'linux', 'x64', {
        download: () => {
          downloads += 1;
          return Promise.resolve(new Uint8Array());
        },
        unpack: () => undefined,
      });
      strictEqual(downloads, 0);
    });

    it('#253 Q14: a platform with no pinned build throws', async () => {
      await rejects(
        vscodiumExecutableOf(workspace.root, 'darwin', 'arm64', {
          download: () => Promise.resolve(new Uint8Array()),
          unpack: () => undefined,
        }),
        {message: 'no VSCodium build is pinned for darwin-arm64'},
      );
    });

    it('#253 Q14: a download that answers with an error status throws after its one retry', async () => {
      await rejects(
        downloadWithRetry(
          'https://example.invalid/a',
          () => Promise.resolve(new Response('', {status: 404})),
          () => Promise.resolve(),
        ),
        {message: 'https://example.invalid/a: 404'},
      );
    });

    it('#253 Q14: a download returns the bytes the server sent', async () => {
      deepStrictEqual(
        await downloadWithRetry(
          'https://example.invalid/a',
          () => Promise.resolve(new Response(new Uint8Array([7, 8]))),
          () => Promise.resolve(),
        ),
        new Uint8Array([7, 8]),
      );
    });

    it('#253 Q14: an archive is unpacked into the folder and its own file removed', () => {
      workspace.write('source/codium-insiders', 'binary');
      const archive = path.join(workspace.root, 'source.tar.gz');
      runCommand('tar', [
        '-czf',
        archive,
        '-C',
        path.join(workspace.root, 'source'),
        '.',
      ]);
      unpackArchive(
        readFileSync(archive),
        path.join(workspace.root, 'unpacked'),
      );
      deepStrictEqual(
        [
          readFileSync(
            path.join(workspace.root, 'unpacked', 'codium-insiders'),
            'utf8',
          ),
          existsSync(path.join(workspace.root, 'unpacked', 'archive.tar.gz')),
        ],
        ['binary', false],
      );
    });

    it('#253 Q14: --editor vs is not understood', () => {
      strictEqual(editorChoiceOf(['--editor', 'vs']), undefined);
    });

    it('#253 Q14: --editor vscodium picks VSCodium', () => {
      strictEqual(editorChoiceOf(['--editor', 'vscodium']), 'vscodium');
    });

    it('#253 Q14: no arguments pick VS Code', () => {
      strictEqual(editorChoiceOf([]), 'vscode');
    });

    it('#253 Q14: an extra argument is not understood', () => {
      strictEqual(editorChoiceOf(['--editor', 'vscode', 'more']), undefined);
    });

    it('#253 Q14: the tool exits 2 with the usage line for an unknown editor', () => {
      const result = runCommand(process.execPath, [
        path.join(REPOSITORY_ROOT, 'tools', 'acceptance.ts'),
        '--editor',
        'vs',
      ]);
      deepStrictEqual([result.status, result.stderr.trim()], [2, USAGE]);
    });
  });

  describe('bundleSuite', () => {
    beforeEach(() => {
      workspace.write(
        'tests/acceptance/suite/host.test.ts',
        "import {helper} from './helper.ts';\nhelper();\n",
      );
      workspace.write(
        'tests/acceptance/suite/helper.ts',
        'export function helper(): void {}\n',
      );
      workspace.write('tests/acceptance/suite-local/window.test.ts', '');
      workspace.write('tests/acceptance/suite-remote/window.test.ts', '');
      workspace.write('tests/acceptance/suite-reconnect/window.test.ts', '');
      workspace.write('tests/acceptance/suite-failure/window.test.ts', '');
      workspace.write('tests/acceptance/suite-terminal/window.test.ts', '');
    });

    it('bundles each suite test file into one CommonJS file', async () => {
      await bundleSuite(workspace.root);
      deepStrictEqual(
        [
          existsSync(
            path.join(workspace.root, 'tests/acceptance/dist/host.test.cjs'),
          ),
          existsSync(
            path.join(workspace.root, 'tests/acceptance/dist/helper.cjs'),
          ),
        ],
        [true, false],
      );
    });

    it('#439: a bundle a former run left in an output folder is gone after bundling', async () => {
      workspace.write('tests/acceptance/dist-failure/stale.test.cjs', '');
      await bundleSuite(workspace.root);
      strictEqual(
        existsSync(
          path.join(
            workspace.root,
            'tests/acceptance/dist-failure/stale.test.cjs',
          ),
        ),
        false,
      );
    });

    it('#439: removeBundles leaves no output folder', async () => {
      await bundleSuite(workspace.root);
      removeBundles(workspace.root);
      deepStrictEqual(
        [
          'dist',
          'dist-local',
          'dist-remote',
          'dist-reconnect',
          'dist-failure',
          'dist-terminal',
        ].map(folder =>
          existsSync(path.join(workspace.root, 'tests/acceptance', folder)),
        ),
        [false, false, false, false, false, false],
      );
    });

    it('bundles the suite of each launch into its own folder', async () => {
      await bundleSuite(workspace.root);
      deepStrictEqual(
        [
          'dist-local',
          'dist-remote',
          'dist-reconnect',
          'dist-failure',
          'dist-terminal',
        ].map(folder =>
          existsSync(
            path.join(
              workspace.root,
              'tests/acceptance',
              folder,
              'window.test.cjs',
            ),
          ),
        ),
        [true, true, true, true, true],
      );
    });
  });

  it('collects the exit status and output of a command', () => {
    deepStrictEqual(
      runCommand(process.execPath, [
        '-e',
        'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 4',
      ]),
      {status: 4, stdout: 'out', stderr: 'err'},
    );
  });

  it("returns test-cli's failure when it cannot load the configuration", async () => {
    notStrictEqual(
      (
        await runTestCli(workspace.root, {
          REMOTE_OSS_ACCEPTANCE: '1',
          HARNESS_SSH_CONFIG: '',
          HARNESS_CONTAINER: '',
          HARNESS_RUN_FOLDER: '',
          REMOTE_OSS_ACCEPTANCE_SCRIPT: '',
          REMOTE_OSS_ACCEPTANCE_RECORD: '',
          HARNESS_VSIX_FILES: '',
          HARNESS_EDITOR: 'vscode',
        })
      ).exitCode,
      0,
    );
  });
});
