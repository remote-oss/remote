import {deepStrictEqual} from 'node:assert';
import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  symlinkSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
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

/** The unpack percents a run printed, in order. */
function unpackPercents(lines: readonly string[]): number[] {
  return lines.flatMap(line => {
    const match = /^remote-oss-server-progress unpack (\d+)$/.exec(line);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
}

/** The smallest step between consecutive percents, ignoring the closing 100. */
function smallestStep(percents: readonly number[]): number {
  const steps = percents
    .slice(0, -1)
    .map((percent, index) => (percents[index + 1] ?? percent) - percent);
  return Math.min(...steps.slice(0, -1));
}

/**
 * Puts the lock file of the parameters in the temporary folder, under a name no other fake host shares, so that test
 * runs on one machine cannot meet at one path. Returns the lock file's path.
 */
function lockInTemporaryFolder(
  host: FakeHost,
  parameters: ScriptParameters,
): string {
  parameters.lock.inTemporaryFolder = true;
  parameters.lock.filePrefix = `boot-lock.${path.basename(path.dirname(host.home))}`;
  return `/tmp/${parameters.lock.filePrefix}.abc123`;
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

  function copiedParameters(removeArchive: boolean): ScriptParameters {
    const parameters = parametersFor();
    parameters.archivePath = path.join(host.home, 'copied.tar.gz');
    copyFileSync(host.archive, parameters.archivePath);
    parameters.removeArchive = removeArchive;
    return parameters;
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

    /** Runs the probe with the loader folders `/lib` and `/usr/lib` pointed into a root that holds `loaders`. */
    function libcWithLoaders(loaders: readonly string[]): unknown {
      const root = path.join(host.home, 'loader-root');
      for (const loader of loaders) {
        mkdirSync(path.join(root, path.dirname(loader)), {recursive: true});
        writeFileSync(path.join(root, loader), '');
      }
      return statusAndFacts(
        host,
        single('probe'),
        parametersFor(),
        ['host.libc'],
        {
          rewriteScript: script =>
            script
              .replaceAll('/usr/lib/ld-musl-', `${root}/usr/lib/ld-musl-`)
              .replaceAll(' /lib/ld-musl-', ` ${root}/lib/ld-musl-`),
        },
      );
    }

    it('F-2401: a musl loader in /lib alone makes the host musl', () => {
      deepStrictEqual(libcWithLoaders(['lib/ld-musl-x86_64.so.1']), {
        status: 'Ok',
        'host.libc': 'musl',
      });
    });

    it('F-2401: a musl loader in /usr/lib alone makes the host musl', () => {
      deepStrictEqual(libcWithLoaders(['usr/lib/ld-musl-aarch64.so.1']), {
        status: 'Ok',
        'host.libc': 'musl',
      });
    });

    it('F-2401: a musl loader beats getconf on a host that has both', () => {
      useHost(['wget', 'getconf']);
      deepStrictEqual(libcWithLoaders(['lib/ld-musl-x86_64.so.1']), {
        status: 'Ok',
        'host.libc': 'musl',
      });
    });

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
      const lock = lockInTemporaryFolder(host, parameters);
      runScript(host, single('install'), parameters);
      const targetLeft = existsSync(`${lock}.target`);
      rmSync(lock, {force: true});
      deepStrictEqual(targetLeft, false);
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

    /** An archive whose entries start with `./`, as the VSCodium server archives are packed: no folder around them. */
    function rootedArchive(): string {
      const source = path.join(host.home, 'rooted-source');
      mkdirSync(path.join(source, 'bin'), {recursive: true});
      mkdirSync(path.join(source, 'extensions', 'one'), {recursive: true});
      mkdirSync(path.join(source, 'out'));
      writeFileSync(path.join(source, 'bin', 'launcher'), '#!/bin/sh\n');
      chmodSync(path.join(source, 'bin', 'launcher'), 0o755);
      writeFileSync(path.join(source, 'extensions', 'one', 'index.js'), '');
      writeFileSync(path.join(source, 'out', 'main.js'), '');
      writeFileSync(path.join(source, 'product.json'), '{}\n');
      const archive = path.join(host.home, 'rooted.tar.gz');
      spawnSync('tar', ['-czf', archive, '-C', source, '.']);
      return archive;
    }

    it('F-2407: an archive with its entries at the root is unpacked as it is, not flattened', () => {
      const parameters = parametersFor();
      parameters.archivePath = rootedArchive();
      runScript(host, single('install'), parameters);
      deepStrictEqual(
        [
          'bin/launcher',
          'extensions/one/index.js',
          'out/main.js',
          'product.json',
        ].map(file => existsSync(path.join(installFolder(host), file))),
        [true, true, true, true],
      );
    });

    /** An archive of the given entries, each a file named by its path, packed from the folder they are made in. */
    function archiveOf(
      files: readonly string[],
      links: Readonly<Record<string, string>> = {},
    ): string {
      const source = path.join(host.home, 'custom-source');
      rmSync(source, {recursive: true, force: true});
      mkdirSync(source, {recursive: true});
      for (const file of files) {
        mkdirSync(path.dirname(path.join(source, file)), {recursive: true});
        writeFileSync(path.join(source, file), '');
      }
      for (const [name, target] of Object.entries(links)) {
        symlinkSync(target, path.join(source, name));
      }
      const archive = path.join(host.home, 'custom.tar.gz');
      spawnSync('tar', ['-czf', archive, '-C', source, '.']);
      return archive;
    }

    function installedPaths(): string[] {
      return readdirSync(installFolder(host)).filter(
        name => !name.startsWith('boot-lock'),
      );
    }

    it('F-2407: one top folder and a file beside it are not a wrapper, so the entries keep their paths', () => {
      const parameters = parametersFor();
      parameters.archivePath = archiveOf(['top/inside', 'beside']);
      runScript(host, single('install'), parameters);
      deepStrictEqual(installedPaths().sort(), ['beside', 'top']);
    });

    it('F-2407: one top folder that holds everything is a wrapper, and is stripped', () => {
      const parameters = parametersFor();
      parameters.archivePath = archiveOf(['top/inside', 'top/deeper/file']);
      runScript(host, single('install'), parameters);
      deepStrictEqual(installedPaths().sort(), ['deeper', 'inside']);
    });

    it('F-2407: a link to a folder as the only entry is not a wrapper, and the folder it names is left alone', () => {
      const outside = path.join(host.home, 'outside');
      mkdirSync(outside);
      writeFileSync(path.join(outside, 'secret'), '');
      const parameters = parametersFor();
      parameters.archivePath = archiveOf([], {'only-link': outside});
      runScript(host, single('install'), parameters);
      deepStrictEqual(
        [installedPaths(), existsSync(path.join(outside, 'secret'))],
        [['only-link'], true],
      );
    });

    it('F-2407: an archive with its entries at the root has its launcher run as the install, so a second install finds it', () => {
      const parameters = parametersFor();
      parameters.archivePath = rootedArchive();
      runScript(host, single('install'), parameters);
      deepStrictEqual(
        statusAndFacts(host, single('probe'), parameters, ['server.installed']),
        {status: 'Ok', 'server.installed': 'yes'},
      );
    });

    it('V4: an archive already on the host is removed when the parameters say so', () => {
      const parameters = copiedParameters(true);
      runScript(host, single('install'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), false);
    });

    it('V4: a copied archive is removed when the unpack fails', () => {
      const parameters = copiedParameters(true);
      writeFileSync(parameters.archivePath, 'not an archive');
      runScript(host, single('install'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), false);
    });

    it('V4: a copied archive is removed when the install folder cannot be created', () => {
      const parameters = copiedParameters(true);
      writeFileSync(path.join(host.home, '.server-data'), '');
      runScript(host, single('install'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), false);
    });

    it('V4: a copied archive is removed when the server is already installed', () => {
      runScript(host, single('install'), parametersFor());
      const parameters = copiedParameters(true);
      runScript(host, single('install'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), false);
    });

    it('V4: a copied archive stays while the host lock is busy, because the step is tried again', () => {
      holdLinkLock(host);
      const parameters = copiedParameters(true);
      runScript(host, single('install'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), true);
    });

    it('V4: the discard step removes a copied archive', () => {
      const parameters = copiedParameters(true);
      runScript(host, single('discard'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), false);
    });

    it('V4: the discard step keeps an archive the parameters do not mark', () => {
      const parameters = copiedParameters(false);
      runScript(host, single('discard'), parameters);
      deepStrictEqual(existsSync(parameters.archivePath), true);
    });

    it('V4: the discard step reports Ok', () => {
      deepStrictEqual(
        statusOf(host, single('discard'), copiedParameters(true)),
        'Ok',
      );
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

    it('V1: the unpack starts at 0 and ends at 100', () => {
      const percents = unpackPercents(
        runScript(host, single('install'), parametersFor()),
      );
      deepStrictEqual([percents.at(0), percents.at(-1)], [0, 100]);
    });

    it('V1: the unpack percents never go down', () => {
      const percents = unpackPercents(
        runScript(host, single('install'), parametersFor()),
      );
      deepStrictEqual(
        percents,
        [...percents].sort((first, second) => first - second),
      );
    });

    it('V1: the unpack prints a percent at most once per 5 points', () => {
      const percents = unpackPercents(
        runScript(host, single('install'), parametersFor()),
      );
      deepStrictEqual(smallestStep(percents) >= 5, true);
    });

    it('V1: the progress lines come before the result block', () => {
      const lines = runScript(host, single('install'), parametersFor());
      const begin = lines.indexOf('remote-oss-server-result-begin');
      deepStrictEqual(
        lines
          .slice(begin)
          .some(line => line.startsWith('remote-oss-server-progress')),
        false,
      );
    });

    it('V1: a run that prints progress lines still has its result block', () => {
      deepStrictEqual(statusOf(host, single('install'), parametersFor()), 'Ok');
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
        deepStrictEqual(
          statusOf(host, single('start'), socket(), {
            environment: {SERVER_READY_TEXT: '4321'},
          }),
          'ServerFailedToStart',
        );
      });
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

    it('F-2413.BR-9: cleanup removes the three socket files of an install it removes', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      const dataFolder = path.join(host.home, '.server-data');
      mkdirSync(dataFolder, {recursive: true});
      for (const extension of ['log', 'pid', 'token']) {
        writeFileSync(path.join(dataFolder, `.old2.socket.${extension}`), '');
      }
      binAfter(['new1', 'old2', 'abc123'], parameters);
      deepStrictEqual(
        ['log', 'pid', 'token'].map(extension =>
          existsSync(path.join(dataFolder, `.old2.socket.${extension}`)),
        ),
        [false, false, false],
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

  describe('a server that is already there, and the lock', function () {
    this.timeout(60_000);

    function dataFolder(): string {
      return path.join(host.home, '.server-data');
    }

    const children: ChildProcess[] = [];

    afterEach(() => {
      for (const child of children.splice(0)) {
        child.kill('SIGKILL');
      }
    });

    /** Starts a process that outlives the call, and returns it. */
    function background(
      command: string,
      commandArguments: readonly string[],
      environment: Record<string, string>,
      logFile?: string,
    ): ChildProcess {
      const output = logFile === undefined ? 'ignore' : openSync(logFile, 'w');
      const child = spawn(command, commandArguments, {
        env: {...host.environment, ...environment},
        stdio: ['ignore', output, output],
        detached: true,
      });
      if (typeof output === 'number') {
        closeSync(output);
      }
      children.push(child);
      return child;
    }

    function startedCount(): number {
      const file = host.environment.SERVER_STARTS ?? '';
      return existsSync(file)
        ? readFileSync(file, 'utf8').trim().split('\n').length
        : 0;
    }

    /** A server of an earlier start that is still on its way to ready: its pid, log and token are recorded. */
    function installWithSlowServer(): void {
      runScript(host, single('install'), parametersFor());
      const slow = background(
        path.join(installFolder(host), 'bin', 'launcher'),
        [],
        {SERVER_READY_AFTER: '2'},
        path.join(dataFolder(), '.abc123.log'),
      );
      writeFileSync(
        path.join(dataFolder(), '.abc123.pid'),
        `${String(slow.pid)}\n`,
      );
      writeFileSync(
        path.join(dataFolder(), '.abc123.token'),
        'token-of-the-first-start',
      );
    }

    it('F-2409.BR-8: a recorded pid that is not the server is not taken for it', () => {
      runScript(host, single('install'), parametersFor());
      const stranger = background('/bin/sleep', ['300'], {});
      writeFileSync(
        path.join(dataFolder(), '.abc123.pid'),
        `${String(stranger.pid)}\n`,
      );
      writeFileSync(
        path.join(dataFolder(), '.abc123.log'),
        'Extension host agent listening on 4242\n',
      );
      deepStrictEqual(
        statusAndFacts(host, single('start'), parametersFor(), ['server.port']),
        {status: 'Ok', 'server.port': '4321'},
      );
    });

    it('F-2409.BR-8: a start never answers with an empty connection token', () => {
      runScript(host, single('install'), parametersFor());
      runScript(host, single('start'), parametersFor());
      const block = blockOf(host, single('start'), parametersFor());
      deepStrictEqual(
        block === 'none' ? '' : (block.serverFacts.token ?? '').length > 0,
        true,
      );
    });

    it('F-2409.BR-8: a server that is still starting is waited for, not started a second time', () => {
      installWithSlowServer();
      const parameters = parametersFor();
      parameters.start.readySeconds = 8;
      runScript(host, single('start'), parameters);
      deepStrictEqual(startedCount(), 1);
    });

    it('F-2409.BR-8: a server that is still starting becomes the answer once it is ready', () => {
      installWithSlowServer();
      const parameters = parametersFor();
      parameters.start.readySeconds = 8;
      deepStrictEqual(
        statusAndFacts(host, single('start'), parameters, ['server.port']),
        {status: 'Ok', 'server.port': '4321'},
      );
    });

    it('F-2408.BR-3: a start waits on the host lock another window holds', () => {
      runScript(host, single('install'), parametersFor());
      holdLinkLock(host);
      deepStrictEqual(
        statusOf(host, single('start'), parametersFor()),
        'LockBusy',
      );
    });

    for (const shell of ['/bin/sh', '/bin/dash']) {
      for (const method of ['flock', 'link'] as const) {
        it(`F-2408.BR-3: a lock that cannot be opened is LockBusy under ${shell}, by ${method}`, () => {
          useHost(['wget', 'flock']);
          mkdirSync(installFolder(host), {recursive: true});
          chmodSync(installFolder(host), 0o555);
          const parameters = parametersFor();
          parameters.lock.method = method;
          const status = statusOf(host, single('install'), parameters, {shell});
          chmodSync(installFolder(host), 0o755);
          deepStrictEqual(status, 'LockBusy');
        });
      }
    }

    /** Runs an install whose /tmp lock is a symlink to a file that must stay as it is. */
    function installOverSymlinkedLock(): {status: string; victim: string} {
      const victim = path.join(path.dirname(host.callsFile), 'victim.txt');
      writeFileSync(victim, 'keep me');
      const parameters = parametersFor();
      const link = lockInTemporaryFolder(host, parameters);
      symlinkSync(victim, link);
      const status = statusOf(host, single('install'), parameters);
      unlinkSync(link);
      return {status, victim};
    }

    /** Starts an install whose download takes a while, interrupts the shell with `signal`, and waits for it to end. */
    async function installInterruptedBy(
      signal: NodeJS.Signals,
      shellProgram: string,
    ): Promise<void> {
      const shell = spawn(shellProgram, ['-s'], {
        env: {...host.environment, STUB_FETCH_SLEEP: '2'},
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      shell.stdin.end(
        scriptFor(single('install'), 'posixShell', parametersFor()),
      );
      const lock = path.join(
        installFolder(host),
        'boot-lock.user.abc123.target',
      );
      for (let wait = 0; wait < 50 && !existsSync(lock); wait++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      shell.kill(signal);
      await new Promise(resolve => shell.once('exit', resolve));
    }

    for (const shellProgram of ['/bin/sh', '/bin/dash']) {
      for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
        it(`F-2408.BR-4: an install interrupted by ${signal} under ${shellProgram} does not leave its link lock behind`, async () => {
          await installInterruptedBy(signal, shellProgram);
          deepStrictEqual(
            existsSync(
              path.join(installFolder(host), 'boot-lock.user.abc123.target'),
            ),
            false,
          );
        });
      }
    }

    it('F-2408.BR-4: a lock another window holds is not released by an install that gave up on it', () => {
      const lock = holdLinkLock(host);
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(existsSync(`${lock}.target`), true);
    });

    it('F-2408.BR-2: a lock in the temporary folder that is a symlink is refused', () => {
      const outcome = installOverSymlinkedLock();
      deepStrictEqual(outcome.status, 'LockBusy');
    });

    it('F-2408.BR-2: a lock in the temporary folder that is a symlink leaves its target alone', () => {
      const outcome = installOverSymlinkedLock();
      deepStrictEqual(readFileSync(outcome.victim, 'utf8'), 'keep me');
    });

    it('F-2411.BR-3: kill leaves a process alone whose pid is only recorded', () => {
      runScript(host, single('install'), parametersFor());
      const marker = path.join(path.dirname(host.callsFile), 'got-signal');
      const stranger = background(
        '/bin/sh',
        [
          '-c',
          `trap 'echo got >"${marker}"; exit 0' TERM; while :; do sleep 1; done`,
        ],
        {},
      );
      spawnSync('/bin/sleep', ['0.5']);
      writeFileSync(
        path.join(dataFolder(), '.abc123.pid'),
        `${String(stranger.pid)}\n`,
      );
      runScript(host, single('kill'), parametersFor());
      spawnSync('/bin/sleep', ['1.5']);
      deepStrictEqual(existsSync(marker), false);
    });

    /** The marker file a process writes when it is sent TERM. */
    function markerOf(name: string): string {
      return path.join(path.dirname(host.callsFile), `got-signal-${name}`);
    }

    /** The script of a process that records the TERM it gets and otherwise waits. */
    function trapScript(marker: string): string {
      return `trap 'echo got >"${marker}"; exit 0' TERM; while :; do sleep 1; done`;
    }

    /** Starts a shell as `program` with these arguments after its script; returns the marker its TERM writes. */
    function started(
      name: string,
      program: string,
      commandArguments: readonly string[] = [],
    ): string {
      const marker = markerOf(name);
      const child = spawn(
        '/bin/sh',
        ['-c', trapScript(marker), ...commandArguments],
        {
          env: host.environment,
          stdio: 'ignore',
          detached: true,
          argv0: program,
        },
      );
      children.push(child);
      return marker;
    }

    /** The launcher's script, under cli/servers/, as the server's own is. */
    function launcherScript(): string {
      return path.join(
        dataFolder(),
        'cli',
        'servers',
        'Stable-abc123',
        'server',
        'bin',
        'launcher',
      );
    }

    /**
     * Starts `script` with a shell, named `program` in the command line, so that the script is its argv[1]; the script
     * records the TERM it gets. Returns the marker.
     */
    function startedScript(
      name: string,
      program: string,
      script: string,
    ): string {
      const marker = markerOf(name);
      mkdirSync(path.dirname(script), {recursive: true});
      writeFileSync(script, trapScript(marker));
      children.push(
        spawn('/bin/sh', [script], {
          env: host.environment,
          stdio: 'ignore',
          detached: true,
          argv0: program,
        }),
      );
      return marker;
    }

    /** Runs a kill, gives the signals time to arrive, and says which of the markers were written. */
    function afterKill(markers: Record<string, string>): string[] {
      runScript(host, single('kill'), parametersFor());
      spawnSync('/bin/sleep', ['1.5']);
      return Object.keys(markers).filter(name =>
        existsSync(markers[name] ?? ''),
      );
    }

    function serverFile(): string {
      return `${dataFolder()}/cli/servers/Stable-abc123/server/node`;
    }

    it('F-2411.BR-3: kill stops the server of the CLI path, which runs a file under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {server: started('server', serverFile())};
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), ['server']);
    });

    it("F-2411.BR-3: kill stops the server's launcher, a shell running a script under cli/servers/", () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        launcher: startedScript('launcher', 'sh', launcherScript()),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), ['launcher']);
    });

    it('F-2412 AC-27: kill leaves a sleep that only names a path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        sleeper: started('sleeper', 'sleep', ['30', serverFile()]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it('F-2412 AC-27: kill leaves an editor that only names a path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {editor: started('editor', 'vim', [serverFile()])};
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it('F-2412 AC-27: kill leaves a program that is not a shell and has a script under cli/servers/ as its first argument', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        editor: startedScript('editor', 'vim', launcherScript()),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it('F-2412 AC-27: kill leaves a shell that is not one of the four, running a script under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        fish: startedScript('fish', '/usr/bin/fish', launcherScript()),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it('F-2412 AC-27: kill leaves a program whose file only contains the path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        copy: started('copy', `/copy${serverFile()}`),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it('F-2412 AC-27: kill leaves a shell whose script only contains the path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        copy: startedScript(
          'copy',
          'sh',
          path.join(dataFolder(), 'copy', launcherScript()),
        ),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it('F-2412 AC-27: kill leaves a node that runs another file', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        other: started('other', '/usr/bin/node', ['/home/user/app.js']),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it("F-2411.BR-3: kill leaves the CLI's command-shell and its supervisor", () => {
      runScript(host, single('install'), parametersFor());
      const cliFile = `${dataFolder()}/codium-cli`;
      const markers = {
        shell: started('shell', cliFile, [
          'command-shell',
          '--cli-data-dir',
          `${dataFolder()}/cli`,
        ]),
        supervisor: started('supervisor', cliFile, [
          '--cli-data-dir',
          `${dataFolder()}/cli`,
          'agent',
          'host',
        ]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterKill(markers), []);
    });

    it('F-2411.BR-4: kill keeps cli/servers/, the connection token and the agent-host token, and removes bin/', () => {
      runScript(host, single('install'), parametersFor());
      mkdirSync(path.join(dataFolder(), 'cli', 'servers', 'Stable-abc123'), {
        recursive: true,
      });
      for (const token of ['connection-token', 'agent-host-token']) {
        writeFileSync(path.join(dataFolder(), 'cli', token), 'token');
      }
      runScript(host, single('kill'), parametersFor());
      deepStrictEqual(
        [
          existsSync(
            path.join(dataFolder(), 'cli', 'servers', 'Stable-abc123'),
          ),
          existsSync(path.join(dataFolder(), 'cli', 'connection-token')),
          existsSync(path.join(dataFolder(), 'cli', 'agent-host-token')),
          existsSync(path.join(dataFolder(), 'bin')),
        ],
        [true, true, true, false],
      );
    });

    it('F-2412.BR-3: uninstall stops the server of the CLI path too', () => {
      runScript(host, single('install'), parametersFor());
      const marker = started('server', serverFile());
      spawnSync('/bin/sleep', ['0.5']);
      runScript(host, single('uninstall'), parametersFor());
      spawnSync('/bin/sleep', ['1.5']);
      deepStrictEqual(existsSync(marker), true);
    });

    it('V1: a fact value with a line end cannot forge a result line', () => {
      const block = blockOf(host, single('probe'), parametersFor(), {
        environment: {DISPLAY: ':0\nstatus=Ok\nserver.port=1'},
      });
      deepStrictEqual(
        block === 'none' ? 'none' : block.serverFacts.port,
        undefined,
      );
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
