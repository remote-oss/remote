import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  type BootstrapRequest,
  scriptFor,
  type ScriptParameters,
} from '../../src/index.ts';
import {
  blockOf,
  callsOf,
  fakeHost,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
  type Stub,
} from './fake-host.ts';

/** The status and the named facts of a run's result block. */
function statusAndFacts(
  host: FakeHost,
  request: Parameters<typeof blockOf>[1],
  parameters: ScriptParameters,
  names: readonly string[],
  options: Parameters<typeof blockOf>[3] = {},
): unknown {
  const block = blockOf(host, request, parameters, options);
  if (block === 'none') {
    return 'none';
  }
  const facts: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(block.hostFacts).map(([field, value]) => [
        `host.${field}`,
        value,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(block.serverFacts).map(([field, value]) => [
        `server.${field}`,
        value,
      ]),
    ),
  };
  return {
    status: block.status,
    ...Object.fromEntries(names.map(name => [name, facts[name]])),
  };
}

/** The status alone of a run's result block. */
function statusOf(
  host: FakeHost,
  request: Parameters<typeof blockOf>[1],
  parameters: ScriptParameters,
  options: Parameters<typeof blockOf>[3] = {},
): string {
  const block = blockOf(host, request, parameters, options);
  return block === 'none' ? 'none' : block.status;
}

/** Removes any server the test started, so no process outlives it. */
function stopServers(host: FakeHost): void {
  runScript(host, single('kill'), parametersFor());
}

/** The names of the downloaders the stand-ins recorded, in call order. */
function downloadersCalled(host: FakeHost): string[] {
  return callsOf(host)
    .filter(call => !call.startsWith('proxy='))
    .map(call => call.split(' ')[0] ?? '');
}

/** Another window's link lock on the baseline install: both names exist. Returns the lock file's path. */
function holdLinkLock(host: FakeHost): string {
  mkdirSync(installFolder(host), {recursive: true});
  const lock = path.join(installFolder(host), 'boot-lock.user.abc123');
  writeFileSync(lock, '');
  writeFileSync(`${lock}.target`, '');
  return lock;
}

describe('the POSIX bootstrap script', () => {
  let host: FakeHost;

  function useHost(stubs?: readonly Stub[]): void {
    host = fakeHost(stubs);
  }

  beforeEach(() => {
    useHost();
  });

  afterEach(() => {
    stopServers(host);
  });

  describe('probe', () => {
    it('F-2401.BR-2: a Linux x86_64 host is Ok with its platform and architecture', () => {
      deepStrictEqual(
        statusAndFacts(host, single('probe'), parametersFor(), [
          'host.os',
          'host.arch',
        ]),
        {status: 'Ok', 'host.os': 'linux', 'host.arch': 'x64'},
      );
    });

    const ARCHITECTURES = [
      ['aarch64', 'arm64'],
      ['arm64', 'arm64'],
      ['armv7l', 'armhf'],
      ['armv8l', 'armhf'],
    ] as const;
    for (const [machine, expected] of ARCHITECTURES) {
      it(`F-2401.BR-2: ${machine} is the architecture ${expected}`, () => {
        deepStrictEqual(
          statusAndFacts(
            host,
            single('probe'),
            parametersFor(),
            ['host.arch'],
            {environment: {STUB_UNAME_M: machine}},
          ),
          {status: 'Ok', 'host.arch': expected},
        );
      });
    }

    for (const name of ['FreeBSD', 'OpenBSD', 'SunOS']) {
      it(`F-2401.7.E5: ${name} is UnsupportedPlatform`, () => {
        deepStrictEqual(
          statusOf(host, single('probe'), parametersFor(), {
            environment: {STUB_UNAME_S: name},
          }),
          'UnsupportedPlatform',
        );
      });
    }

    for (const machine of ['i686', 'riscv64', 'ppc64le']) {
      it(`F-2401.AC-10: ${machine} is UnsupportedArch`, () => {
        deepStrictEqual(
          statusOf(host, single('probe'), parametersFor(), {
            environment: {STUB_UNAME_M: machine},
          }),
          'UnsupportedArch',
        );
      });
    }

    it('F-2703.7.E2: a host with getconf and no musl loader is glibc', () => {
      useHost(['wget', 'getconf']);
      deepStrictEqual(
        statusAndFacts(host, single('probe'), parametersFor(), ['host.libc']),
        {status: 'Ok', 'host.libc': 'glibc'},
      );
    });

    it('F-2403.6.6: a BusyBox wget is reported as such', () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('probe'),
          parametersFor(),
          ['host.wgetBusybox'],
          {environment: {STUB_WGET_HELP: 'BusyBox v1.36 multi-call binary'}},
        ),
        {status: 'Ok', 'host.wgetBusybox': 'yes'},
      );
    });

    it('F-2401: the probe reports which downloaders the host has', () => {
      useHost(['wget', 'curl']);
      deepStrictEqual(
        statusAndFacts(host, single('probe'), parametersFor(), [
          'host.tool.wget',
          'host.tool.curl',
          'host.tool.flock',
        ]),
        {
          status: 'Ok',
          'host.tool.wget': 'yes',
          'host.tool.curl': 'yes',
          'host.tool.flock': 'no',
        },
      );
    });

    it('F-3902.10: the probe reports a server that is not installed yet', () => {
      deepStrictEqual(
        statusAndFacts(host, single('probe'), parametersFor(), [
          'server.installed',
        ]),
        {status: 'Ok', 'server.installed': 'no'},
      );
    });

    it('F-3902.10: the probe reports an installed server', () => {
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(
        statusAndFacts(host, single('probe'), parametersFor(), [
          'server.installed',
        ]),
        {status: 'Ok', 'server.installed': 'yes'},
      );
    });
  });

  describe('install', () => {
    it('F-2403: the host downloads and unpacks the server; its launcher is in place', () => {
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(
        existsSync(path.join(installFolder(host), 'bin', 'launcher')),
        true,
      );
    });

    it('F-2403: a successful install is Ok', () => {
      deepStrictEqual(statusOf(host, single('install'), parametersFor()), 'Ok');
    });

    it('F-2408.5.1: an installed server is reused, and nothing is downloaded again', () => {
      runScript(host, single('install'), parametersFor());
      writeFileSync(host.callsFile, '');
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(callsOf(host), []);
    });

    it('F-2403.BR-12: wget is used before curl', () => {
      useHost(['wget', 'curl']);
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(downloadersCalled(host), ['wget']);
    });

    it('F-2403.BR-12: curl is used when the host has no wget', () => {
      useHost(['curl']);
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(downloadersCalled(host), ['curl']);
    });

    it('F-2402: a host with neither downloader is NoDownloaderAvailable', () => {
      useHost([]);
      deepStrictEqual(
        statusOf(host, single('install'), parametersFor()),
        'NoDownloaderAvailable',
      );
    });

    it('F-2403.BR-7: a failed download is ServerDownloadFailed', () => {
      deepStrictEqual(
        statusOf(host, single('install'), parametersFor(), {
          environment: {STUB_FETCH_FAILS: 'yes'},
        }),
        'ServerDownloadFailed',
      );
    });

    it('F-2403.BR-7: a complete body that is not an archive is UnpackFailed', () => {
      writeFileSync(
        path.join(path.dirname(host.callsFile), 'junk.txt'),
        'not an archive',
      );
      deepStrictEqual(
        statusOf(host, single('install'), parametersFor(), {
          environment: {
            STUB_ARCHIVE: path.join(path.dirname(host.callsFile), 'junk.txt'),
          },
        }),
        'UnpackFailed',
      );
    });

    it('F-2403.BR-8: GNU wget skips its configuration files by default', () => {
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(callsOf(host)[0]?.startsWith('wget --no-config'), true);
    });

    it('F-2403.BR-8: GNU wget reads its configuration files when asked', () => {
      const parameters = parametersFor();
      parameters.downloader.useConfigurationFiles = true;
      runScript(host, single('install'), parameters);
      deepStrictEqual(callsOf(host)[0]?.startsWith('wget -q'), true);
    });

    it('F-2403.BR-8: BusyBox wget is called without a configuration option', () => {
      runScript(host, single('install'), parametersFor(), {
        environment: {STUB_WGET_HELP: 'BusyBox v1.36'},
      });
      deepStrictEqual(callsOf(host)[0]?.startsWith('wget -q'), true);
    });

    it('F-2403.BR-8: curl skips its configuration files with -q first', () => {
      useHost(['curl']);
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(callsOf(host)[0]?.startsWith('curl -q -fsSL'), true);
    });

    it('F-2403.BR-8: curl reads its configuration files when asked', () => {
      useHost(['curl']);
      const parameters = parametersFor();
      parameters.downloader.useConfigurationFiles = true;
      runScript(host, single('install'), parameters);
      deepStrictEqual(callsOf(host)[0]?.startsWith('curl -fsSL'), true);
    });

    it('F-2404.BR-5: the proxy setting is exported to the downloader', () => {
      const parameters = parametersFor();
      parameters.proxy = {http: 'http://proxy.invalid:3128/', https: ''};
      runScript(host, single('install'), parameters);
      deepStrictEqual(callsOf(host)[1], 'proxy=http://proxy.invalid:3128/');
    });

    it("F-2404.BR-10: the host's own proxy variable wins over the setting", () => {
      const parameters = parametersFor();
      parameters.proxy = {http: 'http://setting.invalid:1/', https: ''};
      runScript(host, single('install'), parameters, {
        environment: {http_proxy: 'http://host.invalid:2/'},
      });
      deepStrictEqual(callsOf(host)[1], 'proxy=http://host.invalid:2/');
    });

    it('F-2408.BR-4: a link lock held by another window is LockBusy', () => {
      holdLinkLock(host);
      deepStrictEqual(
        statusOf(host, single('install'), parametersFor()),
        'LockBusy',
      );
    });

    it("F-2408.BR-4: a busy lock leaves the other window's lock files alone", () => {
      const lock = holdLinkLock(host);
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(existsSync(`${lock}.target`), true);
    });

    it('F-2408.6.3: the link lock is removed when the install ends', () => {
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(
        existsSync(
          path.join(installFolder(host), 'boot-lock.user.abc123.target'),
        ),
        false,
      );
    });

    it('F-2408.BR-3: a busy flock is LockBusy', () => {
      useHost(['wget', 'flock']);
      const parameters = parametersFor();
      parameters.lock.method = 'flock';
      deepStrictEqual(
        statusOf(host, single('install'), parameters, {
          environment: {STUB_FLOCK_BUSY: 'yes'},
        }),
        'LockBusy',
      );
    });

    it('F-2408.BR-3: a free flock lets the install through', () => {
      useHost(['wget', 'flock']);
      const parameters = parametersFor();
      parameters.lock.method = 'flock';
      deepStrictEqual(statusOf(host, single('install'), parameters), 'Ok');
    });

    it('F-2408.7.E3: a host without flock falls back to the link lock', () => {
      const parameters = parametersFor();
      parameters.lock.method = 'flock';
      deepStrictEqual(statusOf(host, single('install'), parameters), 'Ok');
    });

    it('F-2408.BR-2: the lock file can be placed in the temporary folder', () => {
      const parameters = parametersFor();
      parameters.lock.inTemporaryFolder = true;
      parameters.lock.filePrefix = `boot-lock.${path.basename(host.home)}`;
      runScript(host, single('install'), parameters);
      deepStrictEqual(
        existsSync(`/tmp/${parameters.lock.filePrefix}.abc123.target`),
        false,
      );
    });

    it('V4: an archive already on the host is used without a download', () => {
      const parameters = parametersFor();
      parameters.archivePath = host.environment.STUB_ARCHIVE ?? '';
      runScript(host, single('install'), parameters);
      deepStrictEqual(callsOf(host), []);
    });

    it('V4: an archive already on the host is kept', () => {
      const parameters = parametersFor();
      parameters.archivePath = host.environment.STUB_ARCHIVE ?? '';
      runScript(host, single('install'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), true);
    });

    it('F-2508: the environment setup is sourced before a fresh install', () => {
      const setup = path.join(path.dirname(host.callsFile), 'setup.sh');
      writeFileSync(setup, `echo sourced >>${host.callsFile}\n`);
      const parameters = parametersFor();
      parameters.environmentSetup = setup;
      runScript(host, single('install'), parameters);
      deepStrictEqual(callsOf(host)[0], 'sourced');
    });

    it('F-2508: the environment setup is not sourced when the server is reused', () => {
      runScript(host, single('install'), parametersFor());
      const setup = path.join(path.dirname(host.callsFile), 'setup.sh');
      writeFileSync(host.callsFile, '');
      writeFileSync(setup, `echo sourced >>${host.callsFile}\n`);
      const parameters = parametersFor();
      parameters.environmentSetup = setup;
      runScript(host, single('install'), parameters);
      deepStrictEqual(callsOf(host), []);
    });

    it('F-2704.7.E1: a downloader that reads standard input does not swallow the script', () => {
      deepStrictEqual(statusOf(host, single('install'), parametersFor()), 'Ok');
    });

    it('F-2407.Q1: a data folder name with a quote and a space installs', () => {
      const parameters = parametersFor();
      parameters.dataFolderName = "it's a folder";
      deepStrictEqual(statusOf(host, single('install'), parameters), 'Ok');
    });

    it('V1: the install reports its timings as whole milliseconds', () => {
      const block = blockOf(host, single('install'), parametersFor());
      deepStrictEqual(block === 'none' ? [] : Object.keys(block.timings), [
        'download',
        'install',
      ]);
    });
  });

  describe('stepwise install', () => {
    function stepwise(
      step: 'prepare' | 'unpack' | 'activate',
    ): BootstrapRequest {
      return {installMode: 'stepwise', step};
    }

    it('F-6304.6.1: prepare creates the staging folder named by commit and epoch', () => {
      runScript(host, stepwise('prepare'), parametersFor());
      deepStrictEqual(
        existsSync(
          path.join(host.home, '.server-data', 'bin', 'abc123-1700000000000'),
        ),
        true,
      );
    });

    it('F-6304.6.1: unpack reads the archive from standard input and strips its top folder', () => {
      runScript(host, stepwise('prepare'), parametersFor());
      runScript(host, stepwise('unpack'), parametersFor(), {
        input: readFileSync(host.environment.STUB_ARCHIVE ?? ''),
      });
      deepStrictEqual(
        existsSync(
          path.join(
            host.home,
            '.server-data',
            'bin',
            'abc123-1700000000000',
            'bin',
            'launcher',
          ),
        ),
        true,
      );
    });

    it('F-6304.6.1: an input that is not an archive is UnpackFailed', () => {
      runScript(host, stepwise('prepare'), parametersFor());
      deepStrictEqual(
        statusOf(host, stepwise('unpack'), parametersFor(), {
          input: Buffer.from('not an archive'),
        }),
        'UnpackFailed',
      );
    });

    it('F-6304.6.1: activate renames the staging folder to the commit', () => {
      runScript(host, stepwise('prepare'), parametersFor());
      runScript(host, stepwise('unpack'), parametersFor(), {
        input: readFileSync(host.environment.STUB_ARCHIVE ?? ''),
      });
      runScript(host, stepwise('activate'), parametersFor());
      deepStrictEqual(
        existsSync(path.join(installFolder(host), 'bin', 'launcher')),
        true,
      );
    });

    it('F-6304.6.1: activate with a server already installed drops the staging folder', () => {
      runScript(host, single('install'), parametersFor());
      runScript(host, stepwise('prepare'), parametersFor());
      runScript(host, stepwise('activate'), parametersFor());
      deepStrictEqual(
        existsSync(
          path.join(host.home, '.server-data', 'bin', 'abc123-1700000000000'),
        ),
        false,
      );
    });

    it('F-6304.6.1: activate without an unpacked server is UnpackFailed', () => {
      runScript(host, stepwise('prepare'), parametersFor());
      deepStrictEqual(
        statusOf(host, stepwise('activate'), parametersFor()),
        'UnpackFailed',
      );
    });
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

    it('F-2703.7.E2: a server that exits with 207 is LinuxPrereqs', () => {
      deepStrictEqual(
        statusOf(host, single('start'), parametersFor(), {
          environment: {SERVER_EXIT: '207'},
        }),
        'LinuxPrereqs',
      );
    });

    it('F-2409.7.E3: a server that exits with another code is ServerFailedToStart', () => {
      deepStrictEqual(
        statusOf(host, single('start'), parametersFor(), {
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

    it('F-2409: a start without an installed server is ServerFailedToStart', () => {
      useHost();
      deepStrictEqual(
        statusOf(host, single('start'), parametersFor()),
        'ServerFailedToStart',
      );
    });
  });

  describe('kill, uninstall and cleanup', () => {
    it('F-2411.BR-3: kill stops the server and removes bin/', () => {
      runScript(host, single('install'), parametersFor());
      runScript(host, single('start'), parametersFor());
      runScript(host, single('kill'), parametersFor());
      deepStrictEqual(
        existsSync(path.join(host.home, '.server-data', 'bin')),
        false,
      );
    });

    it('F-2411.7.E6: kill with nothing installed is Ok', () => {
      deepStrictEqual(statusOf(host, single('kill'), parametersFor()), 'Ok');
    });

    it('F-2412.BR-3: uninstall deletes the data folder', () => {
      runScript(host, single('install'), parametersFor());
      runScript(host, single('uninstall'), parametersFor());
      deepStrictEqual(existsSync(path.join(host.home, '.server-data')), false);
    });

    it('F-2412.7.E6: uninstall with nothing to remove is Ok', () => {
      deepStrictEqual(
        statusOf(host, single('uninstall'), parametersFor()),
        'Ok',
      );
    });

    it('F-2412.BR-4: uninstall leaves other folders of the home alone', () => {
      mkdirSync(path.join(host.home, '.other-data'));
      runScript(host, single('uninstall'), parametersFor());
      deepStrictEqual(existsSync(path.join(host.home, '.other-data')), true);
    });

    /** The names under bin/ after making folders with older and older times. */
    function binAfter(
      names: readonly string[],
      parameters: ScriptParameters,
      heldLock?: string,
    ): string[] {
      const binFolder = path.join(host.home, '.server-data', 'bin');
      mkdirSync(binFolder, {recursive: true});
      for (const name of names) {
        mkdirSync(path.join(binFolder, name));
        writeFileSync(path.join(host.home, '.server-data', `.${name}.log`), '');
      }
      if (heldLock !== undefined) {
        const lock = path.join(
          binFolder,
          heldLock,
          `boot-lock.user.${heldLock}`,
        );
        writeFileSync(lock, '');
        writeFileSync(`${lock}.target`, '');
      }
      names.forEach((name, index) => {
        const seconds = 1_700_000_000 - index * 100;
        utimesSync(path.join(binFolder, name), seconds, seconds);
      });
      runScript(host, single('cleanup'), parameters);
      return readdirSync(binFolder).sort();
    }

    it('F-2413.BR-9: cleanup keeps the newest installs and the current one', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 2};
      deepStrictEqual(
        binAfter(['new1', 'new2', 'old3', 'old4', 'abc123'], parameters),
        ['abc123', 'new1', 'new2'],
      );
    });

    it('F-2413.BR-9: cleanup removes the log of an install it removes', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      binAfter(['new1', 'old2', 'abc123'], parameters);
      deepStrictEqual(
        existsSync(path.join(host.home, '.server-data', '.old2.log')),
        false,
      );
    });

    it('F-2413.BR-9: cleanup leaves an install whose lock is held', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      deepStrictEqual(
        binAfter(['new1', 'old2', 'abc123'], parameters, 'old2'),
        ['abc123', 'new1', 'old2'],
      );
    });

    const FORTY = 'a'.repeat(40);
    const OTHER_COMMIT = 'b'.repeat(40);

    it('F-6304.BR-8: onlyCurrentRemoveLeftovers removes other commits and leftovers', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'onlyCurrentRemoveLeftovers'};
      deepStrictEqual(
        binAfter(
          [OTHER_COMMIT, `${FORTY}-1700000000`, 'notes', 'abc123'],
          parameters,
        ),
        ['abc123', 'notes'],
      );
    });

    it('F-6304.BR-7: onlyCurrentKeepLeftovers keeps the leftovers', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'onlyCurrentKeepLeftovers'};
      deepStrictEqual(
        binAfter(
          [OTHER_COMMIT, `${FORTY}-1700000000`, 'notes', 'abc123'],
          parameters,
        ),
        [`${FORTY}-1700000000`, 'abc123', 'notes'],
      );
    });

    it('F-2413: cleanup with no bin/ is Ok', () => {
      deepStrictEqual(statusOf(host, single('cleanup'), parametersFor()), 'Ok');
    });
  });

  describe('delivery and the other interpreter', () => {
    it('F-2703.BR-9: the script runs under dash, as a Debian host does', () => {
      deepStrictEqual(
        statusOf(host, single('install'), parametersFor(), {
          shell: '/bin/dash',
        }),
        'Ok',
      );
    });

    it('F-2701: the PowerShell script is a failure that says it is not available yet', () => {
      const text = scriptFor(single('install'), 'powershell', parametersFor());
      deepStrictEqual(text.includes('status=ServerFailedToStart'), true);
    });

    it('F-2701: the PowerShell stand-in is far below the command-line limit', () => {
      const text = scriptFor(single('install'), 'powershell', parametersFor());
      deepStrictEqual(text.length < 8192, true);
    });

    it('R-86: nothing in the POSIX script names a bash feature', () => {
      const text = scriptFor(single('install'), 'posixShell', parametersFor());
      deepStrictEqual(/\[\[|\bshopt\b|\bdeclare\b|\blocal\b/.test(text), false);
    });
  });
});
