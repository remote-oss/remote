import {
  deepStrictEqual,
  notStrictEqual,
  rejects,
  strictEqual,
  throws,
} from 'node:assert';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
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
  RETRY_PAUSE_MILLISECONDS,
  runAcceptance,
  runCommand,
  runTestCli,
  unpackArchive,
  USAGE,
  VSCODIUM_RELEASE,
  vscodiumConfigurations,
  vscodiumExecutableOf,
  withOneRetry,
  writeUserSettings,
} from './acceptance.ts';
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

describe('acceptance', () => {
  let workspace: TemporaryWorkspace;
  let harness: FakeHarness;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('acceptance');
    harness = new FakeHarness();
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
      harnessSshConfig(49153, '/run'),
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
    const CONFIGURATION_ENVIRONMENT = {HARNESS_RUN_FOLDER: '/run'};

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

    it('#253 Q14: test-cli ran twice, the local label then the remote one', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(harness.launched, ['local', 'remote']);
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

    it('#253 Q14: with the local run failing the remote one still ran', async () => {
      harness.labelResults.set('local', {exitCode: 3, output: ''});
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(harness.launched, ['local', 'remote']);
    });

    it('#253 Q14: with the remote run failing the exit code is non-zero', async () => {
      harness.labelResults.set('remote', {exitCode: 4, output: ''});
      strictEqual(await runAcceptance(workspace.root, harness, 'vscodium'), 4);
    });

    it('#253 Q14: the remote configuration opens the folder on ssh-remote+harness', () => {
      deepStrictEqual(
        vscodiumConfigurations(
          '/repo',
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
        )[1]?.launchArgs.slice(0, 2),
        ['--folder-uri', 'vscode-remote://ssh-remote+harness/home/harness'],
      );
    });

    it('#253 Q14: the local configuration opens no folder', () => {
      strictEqual(
        vscodiumConfigurations(
          '/repo',
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
        )[0]?.launchArgs.includes('--folder-uri'),
        false,
      );
    });

    it('#253 Q14: both configurations use the executable', () => {
      deepStrictEqual(
        vscodiumConfigurations(
          '/repo',
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
        ).map(configuration => configuration.useInstallation.fromPath),
        [EXECUTABLE, EXECUTABLE],
      );
    });

    it('#253 Q14: both configurations enable the proposed API of remote-ssh', () => {
      deepStrictEqual(
        vscodiumConfigurations(
          '/repo',
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
        ).map(configuration =>
          configuration.launchArgs.includes(
            '--enable-proposed-api=remote-oss.remote-ssh',
          ),
        ),
        [true, true],
      );
    });

    it('#253 Q14: the configurations are labelled and read their own bundles', () => {
      deepStrictEqual(
        vscodiumConfigurations(
          '/repo',
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
        ).map(configuration => [configuration.label, configuration.files]),
        [
          ['local', 'dist-local/**/*.test.cjs'],
          ['remote', 'dist-remote/**/*.test.cjs'],
        ],
      );
    });

    it('#253 Q14: the remote runner is the workspace-kind extension', () => {
      strictEqual(
        vscodiumConfigurations(
          '/repo',
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
        )[1]?.extensionDevelopmentPath,
        path.join('/repo', 'tests', 'acceptance', 'runner-remote'),
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

    it('bundles the local and the remote suite into their own folders', async () => {
      await bundleSuite(workspace.root);
      deepStrictEqual(
        [
          existsSync(
            path.join(
              workspace.root,
              'tests/acceptance/dist-local/window.test.cjs',
            ),
          ),
          existsSync(
            path.join(
              workspace.root,
              'tests/acceptance/dist-remote/window.test.cjs',
            ),
          ),
        ],
        [true, true],
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
