import {deepStrictEqual} from 'node:assert';
import {createHash, randomBytes} from 'node:crypto';
import {
  SHELL_VARIANTS,
  shellVariantsToRun,
} from '../../../tools/host-variants.ts';
import {startHost, type RunningHost} from './host-fixture.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';

/** The connect wait the session is opened with: it is also the bound on the login shell's startup. */
const CONNECT_SECONDS = 5;

/** What the first script of a bounded startup may wait for, in milliseconds: the bound and two seconds of margin. */
const BOUND_AND_MARGIN_MILLISECONDS = (CONNECT_SECONDS + 2) * 1000;

const HOME = '/home/harness';

const TEXT_BYTES = 70_000;

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
  busybox: [exportingProfile('.profile', 'fromprofile')],
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
function boundedHost(host: RunningHost): RunningHost {
  return {
    ...host,
    base: {
      ...host.base,
      settings: {...host.base.settings, connectTimeout: CONNECT_SECONDS},
      effective: {
        ...host.base.effective,
        connectTimeout: String(CONNECT_SECONDS),
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
        const lines = await inSession(
          [],
          async session =>
            (
              await runOn(session, 'read -r line\nprintf \'%s!\\n\' "$line"', {
                text: 'a\\b\n',
              })
            ).lines,
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

      async function twoScripts(host: RunningHost): Promise<{
        statuses: number[];
        firstMilliseconds: number;
        session: SharedSession;
      }> {
        const started = Date.now();
        const session = await openSharedSession(boundedHost(host));
        const statuses: number[] = [];
        let firstMilliseconds = 0;
        for (const script of ['echo one', 'echo two']) {
          const outcome = await session.channel.runScript(
            {
              script,
              interpreter: 'posixShell',
              environment: {},
              input: {kind: 'text', text: ''},
              cancellation: new AbortController().signal,
            },
            () => undefined,
          );
          statuses.push(outcome.kind === 'exited' ? outcome.status : -1);
          firstMilliseconds ||= Date.now() - started;
        }
        return {statuses, firstMilliseconds, session};
      }

      it('#443: a .bash_profile that sleeps 30 s holds the session for the bound alone; both scripts run', async () => {
        write(bash, '.bash_profile', 'sleep 30\n');
        const {statuses, firstMilliseconds, session} = await twoScripts(bash);
        await session.stop();
        deepStrictEqual(
          [statuses, firstMilliseconds < BOUND_AND_MARGIN_MILLISECONDS],
          [[0, 0], true],
        );
      });

      it("#443: right after that session ends no sleep is left on the host, the profile's or the watchdog's", async () => {
        write(bash, '.bash_profile', 'sleep 30\n');
        const {session} = await twoScripts(bash);
        await session.stop();
        deepStrictEqual(
          bash
            .onHost('ps', '-o', 'args')
            .split('\n')
            .some(line => line.includes('sleep')),
          false,
        );
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

      it('#443: a dash .profile that reads standard input and exits 3 leaves both scripts running and LAYER1 empty', async () => {
        write(dash, '.profile', 'export LAYER1=never\nread x\nexit 3\n');
        const session = await openSharedSession(boundedHost(dash));
        const lines: string[] = [];
        const first = await session.channel.runScript(
          {
            script: 'printf \'%s\\n\' "$LAYER1"',
            interpreter: 'posixShell',
            environment: {},
            input: {kind: 'text', text: ''},
            cancellation: new AbortController().signal,
          },
          line => lines.push(line),
        );
        const second = await session.channel.runScript(
          {
            script: 'true',
            interpreter: 'posixShell',
            environment: {},
            input: {kind: 'text', text: ''},
            cancellation: new AbortController().signal,
          },
          () => undefined,
        );
        await session.stop();
        deepStrictEqual(
          [first.kind, second.kind, lines],
          ['exited', 'exited', ['']],
        );
      });
    },
  );
});
