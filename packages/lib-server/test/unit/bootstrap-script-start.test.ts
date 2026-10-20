/**
 * @fileoverview The POSIX bootstrap script's start rows, run for real over stand-in tools.
 */

import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {type ScriptParameters} from '../../src/index.ts';
import {
  blockOf,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';
import {
  installHostHooks,
  statusAndFacts,
  statusOf,
} from './bootstrap-script.fixture.ts';

describe('the POSIX bootstrap script', () => {
  let host: FakeHost;
  const useHost = installHostHooks(made => {
    host = made;
  });

  describe('start', () => {
    beforeEach(() => {
      runScript(host, single('install'), parametersFor());
    });

    function startFacts(
      parameters: ScriptParameters,
      options: Parameters<typeof blockOf>[3] = {},
    ): unknown {
      return statusAndFacts(
        host,
        single('start'),
        parameters,
        ['server.port'],
        options,
      );
    }

    function launcherArguments(): string[] {
      return readFileSync(host.environment.SERVER_ARGUMENTS ?? '', 'utf8')
        .trim()
        .split(' ');
    }

    function valuesAfter(flag: string): string[] {
      return launcherArguments().flatMap((word, index, words) =>
        words[index - 1] === flag ? [word] : [],
      );
    }

    it('V7: the server is started and its port comes from the ready line', () => {
      deepStrictEqual(startFacts(parametersFor()), {
        status: 'Ok',
        'server.port': '4321',
      });
    });

    it('V7: the start options are exactly the contract list, with telemetry off', () => {
      startFacts(parametersFor());
      deepStrictEqual(
        launcherArguments().filter(word => !word.startsWith('/')),
        [
          '--start-server',
          '--host',
          '127.0.0.1',
          '--port',
          '0',
          '--connection-token-file',
          '--telemetry-level',
          'off',
          '--enable-remote-auto-shutdown',
        ],
      );
    });

    it('R-68: the licence terms are not accepted for the user', () => {
      startFacts(parametersFor());
      deepStrictEqual(
        launcherArguments().includes('--accept-server-license-terms'),
        false,
      );
    });

    it('R-68: the licence terms are passed after the user accepted them', () => {
      const parameters = parametersFor();
      parameters.start.licenceAccepted = true;
      startFacts(parameters);
      deepStrictEqual(
        launcherArguments().includes('--accept-server-license-terms'),
        true,
      );
    });

    it('V7: a grace time of 0 passes no option', () => {
      startFacts(parametersFor());
      deepStrictEqual(
        launcherArguments().includes('--reconnection-grace-time'),
        false,
      );
    });

    it('V7: a grace time is passed with its seconds', () => {
      const parameters = parametersFor();
      parameters.start.graceSeconds = 90;
      startFacts(parameters);
      deepStrictEqual(
        launcherArguments().slice(
          launcherArguments().indexOf('--reconnection-grace-time'),
          launcherArguments().indexOf('--reconnection-grace-time') + 2,
        ),
        ['--reconnection-grace-time', '90'],
      );
    });

    it('V7: each default extension gets its own --install-extension', () => {
      const parameters = parametersFor();
      parameters.start.extensions = ['one.alpha', 'two.beta'];
      startFacts(parameters);
      deepStrictEqual(valuesAfter('--install-extension'), [
        'one.alpha',
        'two.beta',
      ]);
    });

    it('F-0505 BR-7: an entry with a quote, a substitution, a leading double quote or a space reaches the server as one literal argument', () => {
      const marker = `${host.environment.HOME ?? ''}/pwned`;
      const entries = [
        `a.b'; touch ${marker} #`,
        `c.d$(touch ${marker})`,
        `e.f\`touch ${marker}\``,
        `"$(touch ${marker})"`,
        '"i.j',
        'g.h@1 --evil',
        'x.y@3.0.1',
      ];
      const parameters = parametersFor();
      parameters.start.extensions = entries;
      startFacts(parameters);
      const words = readFileSync(
        `${host.environment.SERVER_ARGUMENTS ?? ''}.lines`,
        'utf8',
      )
        .trimEnd()
        .split('\n');
      deepStrictEqual(
        [
          words.flatMap((word, index) =>
            words[index - 1] === '--install-extension' ? [word] : [],
          ),
          existsSync(marker),
        ],
        [entries, false],
      );
    });

    it('F-6601: the file watcher polling option is passed with its interval', () => {
      const parameters = parametersFor();
      parameters.start.fileWatcherPollingMilliseconds = 500;
      startFacts(parameters);
      deepStrictEqual(launcherArguments().slice(-2), [
        '--file-watcher-polling',
        '500',
      ]);
    });

    it('V7: the connection token is a 32-character word', () => {
      const block = blockOf(host, single('start'), parametersFor());
      deepStrictEqual(
        block === 'none'
          ? ''
          : /^[A-Za-z0-9]{32}$/.test(block.serverFacts.token ?? ''),
        true,
      );
    });

    it('F-2409.BR-8: a running server is reused with the same port', () => {
      runScript(host, single('start'), parametersFor());
      deepStrictEqual(startFacts(parametersFor()), {
        status: 'Ok',
        'server.port': '4321',
      });
    });

    it('F-2409.BR-8: a running server is not started a second time', () => {
      runScript(host, single('start'), parametersFor());
      runScript(host, single('start'), parametersFor());
      deepStrictEqual(
        readFileSync(host.environment.SERVER_STARTS ?? '', 'utf8')
          .trim()
          .split('\n'),
        ['started'],
      );
    });

    describe('in socket mode', () => {
      function socket(): ScriptParameters {
        const parameters = parametersFor();
        parameters.start.socketMode = true;
        return parameters;
      }

      function dataFiles(): string[] {
        return readdirSync(path.join(host.home, '.server-data'));
      }

      function serverStarts(): string[] {
        return readFileSync(host.environment.SERVER_STARTS ?? '', 'utf8')
          .trim()
          .split('\n');
      }

      function processIdOf(pidFile: string): number {
        return Number(
          readFileSync(path.join(host.home, '.server-data', pidFile), 'utf8'),
        );
      }

      function alive(processId: number): boolean {
        try {
          process.kill(processId, 0);
          return true;
        } catch {
          // A process that is gone raises on a signal of 0.
          return false;
        }
      }

      /** Waits until the processes are gone: a signal returns before the process has exited. */
      async function exited(processes: readonly number[]): Promise<void> {
        for (
          let attempt = 0;
          attempt < 50 && processes.some(alive);
          attempt++
        ) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      function factsOf(parameters: ScriptParameters): Record<string, string> {
        const block = blockOf(host, single('start'), parameters);
        return block === 'none' ? {} : block.serverFacts;
      }

      it('F-2410 BR-4, AC-3: a socket start gives a v4 UUID socket path in the temporary folder and no port', () => {
        const facts = factsOf(socket());
        deepStrictEqual(
          [
            /^\/.*\/code-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
              facts.socketPath ?? '',
            ),
            facts.port,
          ],
          [true, undefined],
        );
      });

      it('F-2410 AC-9: the launcher gets a socket path and neither a host nor a port', () => {
        startFacts(socket());
        deepStrictEqual(
          [
            launcherArguments().includes('--socket-path'),
            launcherArguments().includes('--host'),
            launcherArguments().includes('--port'),
          ],
          [true, false, false],
        );
      });

      it('F-2410 BR-4: the socket lies in the temporary folder of the host', () => {
        const folder = path.join(host.home, 'temporary');
        mkdirSync(folder);
        const block = blockOf(host, single('start'), socket(), {
          environment: {TMPDIR: folder},
        });
        deepStrictEqual(
          block === 'none'
            ? block
            : path.dirname(block.serverFacts.socketPath ?? ''),
          folder,
        );
      });

      /** A socket start with `TMPDIR` as given (`undefined` leaves it unset), and what the start reported about its folder. */
      function folderOutcome(
        temporary: string | undefined,
        shell?: string,
      ): {status: string; folder: string; fallback: string | undefined} {
        const block = blockOf(host, single('start'), socket(), {
          environment: temporary === undefined ? {} : {TMPDIR: temporary},
          ...(shell === undefined ? {} : {shell}),
        });
        return block === 'none'
          ? {status: 'none', folder: '', fallback: undefined}
          : {
              status: block.status,
              folder: path.dirname(block.serverFacts.socketPath ?? ''),
              fallback: block.serverFacts.socketFolderFallback,
            };
      }

      /** A folder of the test whose name holds `separator`. */
      function folderNamed(separator: string): string {
        const folder = path.join(host.home, `my${separator}dir`);
        mkdirSync(folder);
        return folder;
      }

      it('F-2410 BR-4: an absolute folder without white space is used and reports no fallback', () => {
        const folder = path.join(host.home, 'temporary');
        mkdirSync(folder);
        deepStrictEqual(folderOutcome(folder), {
          status: 'Ok',
          folder,
          fallback: undefined,
        });
      });

      it('#342: an absolute folder with a space falls back to /tmp and says why', () => {
        deepStrictEqual(folderOutcome(folderNamed(' ')), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'whiteSpace',
        });
      });

      it('#342: an absolute folder with a tab falls back to /tmp and says why', () => {
        deepStrictEqual(folderOutcome(folderNamed('\t')), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'whiteSpace',
        });
      });

      it('#342: an absolute folder with a newline falls back to /tmp and says why', () => {
        deepStrictEqual(folderOutcome(folderNamed('\n')), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'whiteSpace',
        });
      });

      it('#342: a relative TMPDIR falls back to /tmp, says why, and the start is Ok', () => {
        deepStrictEqual(folderOutcome('tmp'), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'relative',
        });
      });

      it('F-2410 BR-4: an unset TMPDIR uses /tmp as its default and reports no fallback', () => {
        deepStrictEqual(folderOutcome(undefined), {
          status: 'Ok',
          folder: '/tmp',
          fallback: undefined,
        });
      });

      it('F-2410 BR-4: an empty TMPDIR falls back to /tmp and says why', () => {
        deepStrictEqual(folderOutcome(''), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'empty',
        });
      });

      it('#359: an absolute folder that does not exist falls back to /tmp and says why', () => {
        deepStrictEqual(folderOutcome(path.join(host.home, 'missing')), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'unusable',
        });
      });

      it('#359: an absolute path that is a regular file falls back to /tmp and says why', () => {
        const file = path.join(host.home, 'a-file');
        writeFileSync(file, '');
        deepStrictEqual(folderOutcome(file), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'unusable',
        });
      });

      it('#359: an absolute folder with mode 555 falls back to /tmp and says why (skipped when run as root)', function () {
        if (process.getuid?.() === 0) {
          this.skip();
        }
        const folder = path.join(host.home, 'read-only');
        mkdirSync(folder, {mode: 0o555});
        deepStrictEqual(folderOutcome(folder), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'unusable',
        });
      });

      it('#359: under dash a folder that does not exist falls back to /tmp and says why', () => {
        deepStrictEqual(
          folderOutcome(path.join(host.home, 'missing'), '/bin/dash'),
          {status: 'Ok', folder: '/tmp', fallback: 'unusable'},
        );
      });

      it('F-2703 BR-9: under dash a folder with a space falls back to /tmp and says why', () => {
        deepStrictEqual(folderOutcome(folderNamed(' '), '/bin/dash'), {
          status: 'Ok',
          folder: '/tmp',
          fallback: 'whiteSpace',
        });
      });

      it('#342: the path the start reports is the whole path the server was given', () => {
        const block = blockOf(host, single('start'), socket(), {
          environment: {TMPDIR: folderNamed(' ')},
        });
        const given = readFileSync(
          host.environment.SERVER_ARGUMENTS ?? '',
          'utf8',
        )
          .trim()
          .split(' --')
          .find(option => option.startsWith('socket-path '))
          ?.slice('socket-path '.length);
        deepStrictEqual(
          block === 'none' ? block : block.serverFacts.socketPath,
          given,
        );
      });

      it('F-2410 BR-6: a second socket start has the first path and reuses the server', () => {
        const first = factsOf(socket());
        const second = factsOf(socket());
        deepStrictEqual(
          [second.socketPath === first.socketPath, second.reused],
          [true, 'yes'],
        );
      });

      it('F-2410 BR-6: two socket starts launch the server once', () => {
        runScript(host, single('start'), socket());
        runScript(host, single('start'), socket());
        deepStrictEqual(serverStarts(), ['started']);
      });

      it('F-2410 BR-7: a port start after a socket start starts its own server on the port', () => {
        runScript(host, single('start'), socket());
        const facts = factsOf(parametersFor());
        deepStrictEqual([facts.port, facts.reused], ['4321', 'no']);
      });

      it('F-2410 BR-7: the socket server is still alive after a port start beside it', () => {
        runScript(host, single('start'), socket());
        const socketProcess = processIdOf('.abc123.socket.pid');
        runScript(host, single('start'), parametersFor());
        deepStrictEqual(
          [serverStarts(), alive(socketProcess)],
          [['started', 'started'], true],
        );
      });

      it('F-2410 BR-7: a socket start after a port start does not reuse the port server', () => {
        runScript(host, single('start'), parametersFor());
        deepStrictEqual(factsOf(socket()).reused, 'no');
      });

      it('F-2411 POST-1: kill stops the port server and the socket server', async () => {
        runScript(host, single('start'), socket());
        runScript(host, single('start'), parametersFor());
        const processes = [
          processIdOf('.abc123.socket.pid'),
          processIdOf('.abc123.pid'),
        ];
        runScript(host, single('kill'), parametersFor());
        await exited(processes);
        deepStrictEqual(processes.map(alive), [false, false]);
      });

      it('F-2410 BR-6: a socket start keeps its own record files, and makes no port record', () => {
        runScript(host, single('start'), socket());
        deepStrictEqual(
          dataFiles()
            .filter(name => name.startsWith('.abc123'))
            .sort(),
          ['.abc123.socket.log', '.abc123.socket.pid', '.abc123.socket.token'],
        );
      });

      it('#299: a server that reports a port in socket mode fails the start', () => {
        const parameters = socket();
        parameters.start.readySeconds = 1;
        deepStrictEqual(
          statusOf(host, single('start'), parameters, {
            environment: {SERVER_READY_TEXT: '4321'},
          }),
          'ServerFailedToStart',
        );
      });
    });

    describe('the requirements helper (card containers-21)', () => {
      /** Puts the server's own helper into the installed tree: it prints `$HELPER_OUTPUT` and exits `$HELPER_EXIT`. */
      function installHelper(): void {
        const folder = path.join(installFolder(host), 'bin', 'helpers');
        mkdirSync(folder, {recursive: true});
        writeFileSync(
          path.join(folder, 'check-requirements.sh'),
          [
            '[ -z "$HELPER_MARK" ] || : >"$HELPER_MARK"',
            'printf \'%b\' "$HELPER_OUTPUT"',
            'exit "${HELPER_EXIT:-0}"',
            '',
          ].join('\n'),
        );
      }

      function withHelper(): ScriptParameters {
        const parameters = parametersFor();
        parameters.start.requirementsHelper = true;
        return parameters;
      }

      function startWith(
        parameters: ScriptParameters,
        output: string,
        exit: string,
      ): ReturnType<typeof blockOf> {
        return blockOf(host, single('start'), parameters, {
          environment: {
            HELPER_OUTPUT: output,
            HELPER_EXIT: exit,
            HELPER_MARK: path.join(host.home, 'helper-ran'),
          },
        });
      }

      function prerequisiteFacts(block: ReturnType<typeof blockOf>): string[] {
        return block === 'none'
          ? []
          : Object.entries(block.serverFacts)
              .filter(([name]) => name.startsWith('prerequisites.'))
              .map(([name, value]) => `${name}=${value}`);
      }

      it('F-0503 7.E1: exit 99 is LinuxPrereqs with each line as a fact, and the server is not launched', () => {
        installHelper();
        const block = startWith(
          withHelper(),
          'Warning: Missing GLIBC >= 2.28!\\nError: Missing required dependencies.\\n',
          '99',
        );
        deepStrictEqual(
          [
            block === 'none' ? block : block.status,
            prerequisiteFacts(block),
            existsSync(host.environment.SERVER_STARTS ?? ''),
          ],
          [
            'LinuxPrereqs',
            [
              'prerequisites.1=Warning: Missing GLIBC >= 2.28!',
              'prerequisites.2=Error: Missing required dependencies.',
            ],
            false,
          ],
        );
      });

      it('F-0503 5.0 step 6: exit 0 launches the server and keeps no output', () => {
        installHelper();
        const block = startWith(withHelper(), 'Warning: something\\n', '0');
        deepStrictEqual(
          [block === 'none' ? block : block.status, prerequisiteFacts(block)],
          ['Ok', []],
        );
      });

      it('F-0503: another exit code launches the server', () => {
        installHelper();
        const block = startWith(withHelper(), 'odd\\n', '3');
        deepStrictEqual(block === 'none' ? block : block.status, 'Ok');
      });

      it('F-0503 (ruling-253-unrunnable): a helper that cannot run, exit 126 or 127, launches the server', () => {
        installHelper();
        deepStrictEqual(
          ['126', '127'].map(code => {
            const block = startWith(withHelper(), 'cannot run\\n', code);
            return block === 'none' ? block : block.status;
          }),
          ['Ok', 'Ok'],
        );
      });

      it('F-0503: no helper means no check, and a fact says so', () => {
        const block = blockOf(host, single('start'), withHelper());
        deepStrictEqual(
          block === 'none'
            ? block
            : [block.status, block.serverFacts.prerequisitesHelper],
          ['Ok', 'missing'],
        );
      });

      /** The status of a start whose helper exits 99, and whether the helper ran at all. */
      function statusAndRan(parameters: ScriptParameters): [string, boolean] {
        const block = startWith(parameters, 'x\\n', '99');
        return [
          block === 'none' ? block : block.status,
          existsSync(path.join(host.home, 'helper-ran')),
        ];
      }

      it('F-0503: the helper runs only before a launch, never on a reuse', () => {
        installHelper();
        startWith(parametersFor(), '', '0');
        rmSync(path.join(host.home, 'helper-ran'), {force: true});
        deepStrictEqual(statusAndRan(withHelper()), ['Ok', false]);
      });

      it('contracts 5.0: without the flag the helper does not run', () => {
        installHelper();
        deepStrictEqual(statusAndRan(parametersFor()), ['Ok', false]);
      });

      it('F-0503 7.E1: a carriage return is stripped from each line', () => {
        installHelper();
        deepStrictEqual(
          prerequisiteFacts(
            startWith(withHelper(), 'line one\\r\\nline two\\r\\n', '99'),
          ),
          ['prerequisites.1=line one', 'prerequisites.2=line two'],
        );
      });

      it('F-0503 7.E1: the twenty-first line is cut', () => {
        installHelper();
        const output = Array.from(
          Array(21).keys(),
          index => `l${String(index + 1)}`,
        ).join('\\n');
        const names = prerequisiteFacts(
          startWith(withHelper(), output, '99'),
        ).map(fact => fact.split('=')[0]);
        deepStrictEqual([names.length, names.at(-1)], [20, 'prerequisites.20']);
      });

      it('F-0503 7.E1: the five hundred and first character is cut', () => {
        installHelper();
        const facts = prerequisiteFacts(
          startWith(withHelper(), `${'a'.repeat(501)}\\n`, '99'),
        );
        deepStrictEqual(facts, [`prerequisites.1=${'a'.repeat(500)}`]);
      });

      it('F-0503 7.E1: exit 99 with no output is LinuxPrereqs and gives no line', () => {
        installHelper();
        const block = startWith(withHelper(), '', '99');
        deepStrictEqual(
          [block === 'none' ? block : block.status, prerequisiteFacts(block)],
          ['LinuxPrereqs', []],
        );
      });

      it('ADR-0010: a marker line in the helper output stays inside its fact', () => {
        installHelper();
        const block = startWith(
          withHelper(),
          'remote-oss-server-result-end\\n',
          '99',
        );
        deepStrictEqual(
          [block === 'none' ? block : block.status, prerequisiteFacts(block)],
          ['LinuxPrereqs', ['prerequisites.1=remote-oss-server-result-end']],
        );
      });
    });

    it('F-2703.7.E2 (ruling-253-exit): a server that exits with 207 after launch is ServerFailedToStart at the end of the wait, like any other early exit', () => {
      const parameters = parametersFor();
      parameters.start.readySeconds = 1;
      deepStrictEqual(
        statusOf(host, single('start'), parameters, {
          environment: {SERVER_EXIT: '207'},
        }),
        'ServerFailedToStart',
      );
    });

    it('F-2409.7.E3: a server that exits with another code is ServerFailedToStart', () => {
      const parameters = parametersFor();
      parameters.start.readySeconds = 1;
      deepStrictEqual(
        statusOf(host, single('start'), parameters, {
          environment: {SERVER_EXIT: '1'},
        }),
        'ServerFailedToStart',
      );
    });

    it('F-2409.BR-10: a server that never says it is ready fails within the wait', () => {
      const parameters = parametersFor();
      parameters.start.readySeconds = 1;
      deepStrictEqual(
        statusOf(host, single('start'), parameters, {
          environment: {SERVER_SILENT: 'yes'},
        }),
        'ServerFailedToStart',
      );
    });

    /** The noise of ADR-0010 that a user's shell or the server's neighbours may write. */
    const NOISE = [
      'ERROR: Your fridge is not running',
      'see remote-oss-server-result-begin for details',
      'status=Ok',
      'fact host.arch x64',
      'motd: Permission denied (publickey) is a test',
      'ERROR: Your fridge is not running\r',
    ].join('\n');

    /** A start whose wait is one second, so a server that never gives the ready line fails fast. */
    function quickStart(): ScriptParameters {
      const parameters = parametersFor();
      parameters.start.readySeconds = 1;
      return parameters;
    }

    it('ADR-0010: a line that only contains the ready phrase is not the ready line', () => {
      deepStrictEqual(
        statusOf(host, single('start'), quickStart(), {
          environment: {
            SERVER_SILENT: 'yes',
            SERVER_LOG_BEFORE:
              'debug: Extension host agent listening on 1234 (old)',
          },
        }),
        'ServerFailedToStart',
      );
    });

    it('ADR-0010: a ready line behind a prefix is not the ready line, in port mode and in socket mode', () => {
      const socketStart = quickStart();
      socketStart.start.socketMode = true;
      deepStrictEqual(
        [
          statusOf(host, single('start'), quickStart(), {
            environment: {
              SERVER_SILENT: 'yes',
              SERVER_LOG_BEFORE: 'noise Extension host agent listening on 9999',
            },
          }),
          statusOf(host, single('start'), socketStart, {
            environment: {
              SERVER_SILENT: 'yes',
              SERVER_LOG_BEFORE:
                'noise Extension host agent listening on /tmp/code-noise',
            },
          }),
        ],
        ['ServerFailedToStart', 'ServerFailedToStart'],
      );
    });

    it('ADR-0010: the ready port is digits only', () => {
      deepStrictEqual(
        statusOf(host, single('start'), quickStart(), {
          environment: {SERVER_READY_TEXT: '5abc'},
        }),
        'ServerFailedToStart',
      );
    });

    it('ADR-0010: port 0 and a port with a leading zero are not a port', () => {
      deepStrictEqual(
        ['0', '041000'].map(port =>
          statusOf(host, single('start'), quickStart(), {
            environment: {SERVER_READY_TEXT: port},
          }),
        ),
        ['ServerFailedToStart', 'ServerFailedToStart'],
      );
    });

    it('ADR-0010: a failure phrase mid-line is not the failure', () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('start'),
          quickStart(),
          ['server.failure'],
          {
            environment: {
              SERVER_EXIT: '1',
              SERVER_LOG_BEFORE:
                'note: Could not find free port in range earlier',
            },
          },
        ),
        {status: 'ServerFailedToStart', 'server.failure': undefined},
      );
    });

    it('F-2409: the measured ready line after the server binding line gives the port', () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('start'),
          parametersFor(),
          ['server.port'],
          {
            environment: {
              SERVER_LOG_BEFORE: 'Server bound to 127.0.0.1:4321 (IPv4)',
            },
          },
        ),
        {status: 'Ok', 'server.port': '4321'},
      );
    });

    it("F-2409.6.2: the server's measured no-free-port line is noFreePort", () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('start'),
          quickStart(),
          ['server.failure'],
          {
            environment: {
              SERVER_EXIT: '1',
              SERVER_LOG_BEFORE:
                '--port: Could not find free port in range: 1 - 2 (inclusive).',
            },
          },
        ),
        {status: 'ServerFailedToStart', 'server.failure': 'noFreePort'},
      );
    });

    it("F-2409.AC-30: the server's measured CVE-2020-1416 block is cveTerminated", () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('start'),
          quickStart(),
          ['server.failure'],
          {
            environment: {
              SERVER_EXIT: '0',
              SERVER_LOG_BEFORE: [
                '',
                '*',
                '* !!!! Server terminated due to presence of CVE-2020-1416 !!!!',
                '*',
              ].join('\n'),
            },
          },
        ),
        {status: 'ServerFailedToStart', 'server.failure': 'cveTerminated'},
      );
    });

    it('ADR-0010: the CVE text mid-line is not the CVE failure', () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('start'),
          quickStart(),
          ['server.failure'],
          {
            environment: {
              SERVER_EXIT: '1',
              SERVER_LOG_BEFORE:
                'note: * !!!! Server terminated due to presence of CVE-2020-1416 !!!!',
            },
          },
        ),
        {status: 'ServerFailedToStart', 'server.failure': undefined},
      );
    });

    it('ADR-0010: the CVE line with text after it is not the CVE failure', () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('start'),
          quickStart(),
          ['server.failure'],
          {
            environment: {
              SERVER_EXIT: '1',
              SERVER_LOG_BEFORE:
                '* !!!! Server terminated due to presence of CVE-2020-1416 !!!! (quoted)',
            },
          },
        ),
        {status: 'ServerFailedToStart', 'server.failure': undefined},
      );
    });

    it('ADR-0010: noise around the ready line changes nothing', () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('start'),
          parametersFor(),
          ['server.port'],
          {
            environment: {SERVER_LOG_BEFORE: NOISE, SERVER_LOG_AFTER: NOISE},
          },
        ),
        {status: 'Ok', 'server.port': '4321'},
      );
    });

    it('F-2409: a start without an installed server is ServerFailedToStart', () => {
      useHost();
      deepStrictEqual(
        statusOf(host, single('start'), parametersFor()),
        'ServerFailedToStart',
      );
    });
  });
});
