import {deepStrictEqual} from 'node:assert';
import {createHash, randomBytes} from 'node:crypto';
import {
  SHELL_VARIANTS,
  shellVariantsToRun,
} from '../../../tools/host-variants.ts';
import {NOISE_LINES} from 'lib-host/testing/noise';
import {createLogger} from 'lib-log';
import {probe, type RuntimeOptions, startOrReuse} from 'lib-server';
import {connectWaitMilliseconds} from 'lib-ssh';
import {startHost, type RunningHost} from './host-fixture.ts';
import {
  attemptSharedSession,
  openSharedSession,
  type SharedSession,
} from './shared-session.ts';
import {
  installFolderOf,
  installStatus,
  lockLoop,
  parametersFor,
  placeStandInArchive,
} from './support.ts';

/** The connect timeout the session is opened with, as the host's own value. */
const CONNECT_SECONDS = 5;

/** The connect wait of that timeout (F-2105 BR-3), which also bounds the login shell's startup (connect-49). */
const CONNECT_WAIT_MILLISECONDS = connectWaitMilliseconds({
  connectTimeoutSeconds: CONNECT_SECONDS,
  fromHost: true,
  unboundedWaitSeconds: 60,
});

/** What a bounded startup may take, in milliseconds: the connect wait and two seconds of margin. */
const WAIT_AND_MARGIN_MILLISECONDS = CONNECT_WAIT_MILLISECONDS + 2000;

const HOME = '/home/harness';

const TEXT_BYTES = 70_000;

const CANCELLATION = new AbortController().signal;

const SILENT = createLogger(undefined, {minimumLevel: () => 'info'});

/** The options of a start on the stand-in server. */
const START_OPTIONS: RuntimeOptions = {
  bindHost: '127.0.0.1',
  portRange: '',
  licenceAccepted: false,
  graceSeconds: 0,
  defaultExtensions: [],
  fileWatcherPollingMilliseconds: 0,
  readySeconds: 10,
  socketMode: false,
};

/** An address on the host where nothing listens, so its download is refused. */
const REFUSED_ADDRESS = 'http://127.0.0.1:1/server.tar.gz';

/** A startup file to place in the home of the user before a session opens. */
interface StartupFile {
  name: string;
  text: string;
}

/** The login shells of the host image, by the path `usermod -s` takes. */
const LOGIN_SHELLS: ReadonlyArray<{name: string; path: string}> = [
  {name: 'busybox', path: '/bin/sh'},
  {name: 'bash', path: '/bin/bash'},
  {name: 'zshell', path: '/bin/zsh'},
  {name: 'dash', path: '/usr/bin/dash'},
  {name: 'fish', path: '/usr/bin/fish'},
  {name: 'tcsh', path: '/bin/tcsh'},
  {name: 'cshell', path: '/bin/csh'},
  {name: 'mksh', path: '/bin/mksh'},
];

/** A row of BR-4's table: the startup files of a login shell, and what the script sees of them. */
interface LayerRow {
  title: string;
  files: StartupFile[];
  script: string;
  expected: string[];
}

const PRINT_ONE = 'printf \'%s\\n\' "$LAYER1"';

function exportingProfile(name: string, value: string): LayerRow {
  return {
    title: `${name}: the variable of ${name === '.profile' ? '.profile' : name} reaches the script`,
    files: [{name, text: `echo noise\nexport LAYER1=${value}\n`}],
    script: PRINT_ONE,
    expected: [value],
  };
}

/** The layer-1 rows each login shell can show on this host. */
const LAYER_ROWS: Readonly<Record<string, readonly LayerRow[]>> = {
  busybox: [
    exportingProfile('.profile', 'fromprofile'),
    {
      title:
        'ADR-0010: a .profile that prints LAYER1-START and an exit line changes nothing',
      files: [
        {
          name: '.profile',
          text: 'echo LAYER1-START\necho "exit 3"\nexport LAYER1=stillthere\n',
        },
      ],
      script: PRINT_ONE,
      expected: ['stillthere'],
    },
  ],
  bash: [
    exportingProfile('.bash_profile', 'frombashprofile'),
    exportingProfile('.profile', 'fromprofile'),
  ],
  zshell: [
    {
      title: '.zshenv and .zprofile both reach the script',
      files: [
        {name: '.zshenv', text: 'export LAYER1A=fromzshenv\n'},
        {name: '.zprofile', text: 'echo noise\nexport LAYER1B=fromzprofile\n'},
      ],
      script: 'printf \'%s %s\\n\' "$LAYER1A" "$LAYER1B"',
      expected: ['fromzshenv fromzprofile'],
    },
    {
      title: '.profile alone is never read (F-2704 BR-4)',
      files: [{name: '.profile', text: 'export LAYER1=fromprofile\n'}],
      script: PRINT_ONE,
      expected: [''],
    },
  ],
  dash: [exportingProfile('.profile', 'fromprofile')],
  mksh: [
    exportingProfile('.profile', 'fromprofile'),
    {
      title: 'a value with a quote, a newline and a dollar round-trips',
      files: [{name: '.profile', text: 'export LAYER1="it\'s\ntwo \\$x"\n'}],
      script: PRINT_ONE,
      expected: ["it's", 'two $x'],
    },
  ],
  fish: [
    {
      title: 'config.fish with set -gx reaches the script',
      files: [
        {
          name: '.config/fish/config.fish',
          text: 'echo noise\nset -gx LAYER1 fromfish\n',
        },
      ],
      script: PRINT_ONE,
      expected: ['fromfish'],
    },
  ],
  tcsh: [
    {
      title: '.login with setenv reaches the script',
      files: [{name: '.login', text: 'echo noise\nsetenv LAYER1 fromlogin\n'}],
      script: PRINT_ONE,
      expected: ['fromlogin'],
    },
  ],
  cshell: [
    {
      title: '.login with setenv reaches the script',
      files: [{name: '.login', text: 'echo noise\nsetenv LAYER1 fromlogin\n'}],
      script: PRINT_ONE,
      expected: ['fromlogin'],
    },
  ],
};

/** The host with its connect timeout set to the rows' wait (the host's own value wins over the setting): the session reads its bound from it. */
function boundedHost(
  host: RunningHost,
  seconds: number = CONNECT_SECONDS,
): RunningHost {
  return {
    ...host,
    base: {
      ...host.base,
      settings: {...host.base.settings, connectTimeout: seconds},
      effective: {
        ...host.base.effective,
        connectTimeout: String(seconds),
      },
    },
  };
}

describe('F-2704 BR-4, #443: every login shell hands the session to POSIX sh', function () {
  this.timeout(240000);

  for (const shell of LOGIN_SHELLS.filter(each =>
    (shellVariantsToRun(process.env) as readonly string[]).includes(each.path),
  )) {
    describe(`login shell ${shell.name} (${shell.path})`, () => {
      let host: RunningHost;

      before(async () => {
        host = await startHost({shell: shell.path});
      });

      after(() => {
        host.stop();
      });

      function place(files: readonly StartupFile[]): void {
        for (const file of files) {
          host.onHost(
            'sh',
            '-c',
            'mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1"',
            'sh',
            `${HOME}/${file.name}`,
            file.text,
          );
        }
      }

      function remove(files: readonly StartupFile[]): void {
        for (const file of files) {
          host.onHost('rm', '-rf', `${HOME}/${file.name.split('/')[0] ?? ''}`);
        }
      }

      /** Runs a script on the channel and returns its lines and status. */
      async function runOn(
        session: SharedSession,
        script: string,
        options: {
          environment?: Record<string, string>;
          text?: string;
        } = {},
      ): Promise<{lines: string[]; status: number}> {
        const lines: string[] = [];
        const outcome = await session.channel.runScript(
          {
            script,
            interpreter: 'posixShell',
            environment: options.environment ?? {},
            input: {kind: 'text', text: options.text ?? ''},
            cancellation: new AbortController().signal,
          },
          line => lines.push(line),
        );
        return {lines, status: outcome.kind === 'exited' ? outcome.status : -1};
      }

      /** Places the startup files, opens a session, uses it, and takes both down. */
      async function inSession<Result>(
        files: readonly StartupFile[],
        action: (session: SharedSession) => Promise<Result>,
      ): Promise<Result> {
        place(files);
        let session: SharedSession | undefined;
        try {
          session = await openSharedSession(boundedHost(host));
          return await action(session);
        } finally {
          await session?.stop();
          remove(files);
        }
      }

      it('#443, F-2704 AC-10: two multi-line scripts run one after the other on the session, each exiting 0 with its lines', async () => {
        const results = await inSession([], async session => [
          await runOn(session, "echo 'one'\necho 1"),
          await runOn(session, "echo 'two'\necho 2"),
        ]);
        deepStrictEqual(results, [
          {lines: ['one', '1'], status: 0},
          {lines: ['two', '2'], status: 0},
        ]);
      });
      it('#443: the two-line script with a bang prints the backslashed input line as written', async () => {
        const lines: string[] = [];
        await host.channel.runScript(
          {
            script: 'read -r line\nprintf \'%s!\\n\' "$line"',
            interpreter: 'posixShell',
            environment: {},
            input: {kind: 'text', text: 'a\\b\n'},
            cancellation: new AbortController().signal,
          },
          line => lines.push(line),
        );
        deepStrictEqual(lines, ['a\\b!']);
      });

      it("contracts H1: #443, a run's environment reaches the script as written", async () => {
        const lines = await inSession(
          [],
          async session =>
            (
              await runOn(session, 'printf \'%s\\n\' "$QUOTED"', {
                environment: {QUOTED: "a!b'c"},
              })
            ).lines,
        );
        deepStrictEqual(lines, ["a!b'c"]);
      });

      it('contracts H1: #443, a text input of 70 000 random characters arrives byte for byte', async () => {
        const text = randomBytes(TEXT_BYTES)
          .toString('base64')
          .slice(0, TEXT_BYTES);
        const lines = await inSession(
          [],
          async session =>
            (await runOn(session, 'sha256sum | cut -c1-64', {text})).lines,
        );
        deepStrictEqual(lines, [
          createHash('sha256').update(text, 'utf8').digest('hex'),
        ]);
      });

      for (const layer of LAYER_ROWS[shell.name] ?? []) {
        it(`F-2704 BR-4: ${layer.title}`, async () => {
          const lines = await inSession(
            layer.files,
            async session => (await runOn(session, layer.script)).lines,
          );
          deepStrictEqual(lines, layer.expected);
        });
      }
    });
  }

  // The bound is checked on three fixed hosts of its own, so it runs once: with every shell, or with the first.
  const boundRuns = shellVariantsToRun(process.env)[0] === SHELL_VARIANTS[0];
  (boundRuns ? describe : describe.skip)(
    'the bound on the login shell (bash, then zsh and dash)',
    () => {
      let bash: RunningHost;
      let zshell: RunningHost;
      let dash: RunningHost;

      before(async () => {
        [bash, zshell, dash] = await Promise.all([
          startHost({shell: '/bin/bash'}),
          startHost({shell: '/bin/zsh'}),
          startHost({shell: '/usr/bin/dash'}),
        ]);
      });

      after(() => {
        bash.stop();
        zshell.stop();
        dash.stop();
      });

      function write(host: RunningHost, name: string, text: string): void {
        host.onHost(
          'sh',
          '-c',
          'printf "%s" "$2" > "$1"',
          'sh',
          `${HOME}/${name}`,
          text,
        );
      }

      /** The attempt to open a session, with the time it took, and the host's leftovers cleaned up. */
      async function failedAttempt(host: RunningHost, seconds?: number) {
        const started = Date.now();
        const attempt = await attemptSharedSession(boundedHost(host, seconds));
        const milliseconds = Date.now() - started;
        if (attempt.kind === 'connected') {
          await attempt.session.stop();
          return {
            kind: 'connected' as const,
            milliseconds,
            logged: attempt.logged,
          };
        }
        await attempt.stop();
        return {
          kind: 'failed' as const,
          failure: attempt.failure,
          milliseconds,
          logged: attempt.logged,
        };
      }

      it('F-2704 AC-11, #443: a .bash_profile that sleeps 30 s fails the connect as a timeout, at the bound', async () => {
        write(bash, '.bash_profile', 'sleep 30\n');
        const attempt = await failedAttempt(bash);
        deepStrictEqual(
          [
            attempt.kind,
            attempt.kind === 'failed' ? attempt.failure : undefined,
            attempt.milliseconds < WAIT_AND_MARGIN_MILLISECONDS,
          ],
          [
            'failed',
            {kind: 'loginFailed', failure: 'timeout', hints: []},
            true,
          ],
        );
      });

      it("F-2704 AC-11, #443, connect-49: the client's wait ends a login shell that never finishes its startup", async () => {
        write(bash, '.bash_profile', 'sleep 30\n');
        const attempt = await failedAttempt(bash);
        deepStrictEqual(
          [
            attempt.kind === 'failed' ? attempt.failure : attempt.kind,
            attempt.logged.filter(line =>
              line.includes('did not finish its startup'),
            ),
          ],
          [{kind: 'loginFailed', failure: 'timeout', hints: []}, []],
        );
      });

      it("#443: right after that session ends no sleep is left on the host, the profile's or the watchdog's", async () => {
        write(bash, '.bash_profile', 'sleep 30\n');
        await failedAttempt(bash);
        deepStrictEqual(
          bash
            .onHost('ps', '-o', 'args')
            .split('\n')
            .some(line => line.includes('sleep')),
          false,
        );
      });

      it('F-2704 AC-13: a .bash_profile that ends with exit 1 fails the connect at once, with no reason of ssh', async () => {
        write(bash, '.bash_profile', 'exit 1\n');
        const attempt = await failedAttempt(bash);
        deepStrictEqual(
          [
            attempt.kind,
            attempt.kind === 'failed' ? attempt.failure : undefined,
            attempt.milliseconds < 3000,
          ],
          [
            'failed',
            {kind: 'loginFailed', failure: 'unknown', hints: []},
            true,
          ],
        );
      });

      it('F-2704 AC-25: the helper logs that the login shell exited with its status', async () => {
        write(bash, '.bash_profile', 'exit 1\n');
        const attempt = await failedAttempt(bash);
        deepStrictEqual(
          attempt.logged.filter(line => line.includes('login shell')),
          [
            "the SSH session ended before the host reported its platform: the login shell's startup exited with status 1",
          ],
        );
      });

      it('F-2704 AC-14: a .bash_profile that pauses 25 s still connects when the connect timeout is 40 s', async function () {
        this.timeout(120000);
        write(bash, '.bash_profile', 'sleep 25\nexport PAUSED=yes\n');
        const attempt = await failedAttempt(bash, 40);
        deepStrictEqual(attempt.kind, 'connected');
      });

      it('#443: while the first script runs on zsh the watchdog is gone once the login shell ended', async () => {
        write(zshell, '.zprofile', 'export LAYER1=x\n');
        const session = await openSharedSession(boundedHost(zshell));
        const gate = `/tmp/gate-${randomBytes(6).toString('hex')}`;
        const running = session.channel.runScript(
          {
            script: `mkfifo ${gate}; echo up >${gate}.up; read line <${gate}`,
            interpreter: 'posixShell',
            environment: {},
            input: {kind: 'text', text: ''},
            cancellation: new AbortController().signal,
          },
          () => undefined,
        );
        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            zshell
              .onHost('sh', '-c', `test -e ${gate}.up && echo yes || echo no`)
              .trim() === 'yes'
          ) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const sleeping = zshell
          .onHost('ps', '-o', 'args')
          .split('\n')
          .some(line => line.includes('sleep'));
        zshell.onHost('sh', '-c', `echo go >${gate}`);
        await running;
        await session.stop();
        deepStrictEqual(sleeping, false);
      });

      it('F-2704 AC-13, #443: a dash .profile that reads standard input and exits 3 fails the connect with that status', async () => {
        write(dash, '.profile', 'export LAYER1=never\nread x\nexit 3\n');
        const attempt = await failedAttempt(dash);
        deepStrictEqual(
          [
            attempt.kind,
            attempt.logged.filter(line => line.includes('login shell')),
          ],
          [
            'failed',
            [
              "the SSH session ended before the host reported its platform: the login shell's startup exited with status 3",
            ],
          ],
        );
      });
    },
  );
});

describe('F-2206 AC-28, #443: a login shell that does not answer fails the connect', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
  });

  after(() => {
    host.stop();
  });

  it("F-2206 AC-28: the host's mute shell fails the connect as a timeout, after the connect wait and never before it", async () => {
    const started = Date.now();
    const attempt = await attemptSharedSession(
      boundedHost({...host, base: host.baseOf('mute')}),
    );
    const milliseconds = Date.now() - started;
    if (attempt.kind === 'connected') {
      await attempt.session.stop();
    } else {
      await attempt.stop();
    }
    deepStrictEqual(
      [
        attempt.kind === 'failed' ? attempt.failure : attempt.kind,
        milliseconds >= CONNECT_WAIT_MILLISECONDS - 500,
        milliseconds < WAIT_AND_MARGIN_MILLISECONDS,
      ],
      [{kind: 'loginFailed', failure: 'timeout', hints: []}, true, true],
    );
  });
});

describe('ADR-0010, connect-59: a .profile and a ~/.ssh/rc that print noise', function () {
  this.timeout(240000);
  let host: RunningHost;

  /** Every noise line, written to standard output and to standard error. */
  const NOISY_PROFILE = NOISE_LINES.map(
    line => `printf '%s\\n' '${line}'\nprintf '%s\\n' '${line}' >&2\n`,
  ).join('');

  before(async () => {
    host = await startHost();
    placeStandInArchive(host);
  });

  after(() => {
    host.onHost('rm', '-f', `${HOME}/.profile`, `${HOME}/.ssh/rc`);
    host.stop();
  });

  /** What the probe, the install, the start and an install whose download is refused give over a new session. */
  async function serverSteps(): Promise<unknown[]> {
    const session = await openSharedSession(boundedHost(host));
    try {
      const parameters = parametersFor();
      const probed = await probe(session.channel, parameters, CANCELLATION);
      const installed = await installStatus(session, parameters);
      const started = await startOrReuse(
        session.channel,
        parameters,
        START_OPTIONS,
        {
          allowedExtraStartOptions: [],
          extensionEntries: 'identifiersOnly',
          requirementsCheck: 'serverBundled',
        },
        {lockLoop: lockLoop(), logger: SILENT},
        CANCELLATION,
      );
      const refused = await installStatus(
        session,
        parametersFor({archivePath: '', archiveUrl: REFUSED_ADDRESS}),
      );
      return [
        probed.kind === 'probed'
          ? {
              ...probed.host,
              installFolder:
                probed.host.installFolder === installFolderOf(parameters),
            }
          : probed,
        installed,
        started.kind,
        refused,
      ];
    } finally {
      await session.stop();
    }
  }

  it('ADR-0010: the probe, install, start and a refused download give the same results as without them', async () => {
    const quiet = await serverSteps();
    host.onHost(
      'sh',
      '-c',
      'printf "%s" "$2" > "$1/.profile" && printf "%s" "$3" > "$1/.ssh/rc"',
      'sh',
      HOME,
      NOISY_PROFILE,
      `printf '%s\\n' '${NOISE_LINES[0] ?? ''}' >&2\n`,
    );
    const noisy = await serverSteps();
    deepStrictEqual(
      [noisy, quiet.slice(1)],
      [quiet, ['Ok', 'started', 'ServerDownloadFailed']],
    );
  });
});
