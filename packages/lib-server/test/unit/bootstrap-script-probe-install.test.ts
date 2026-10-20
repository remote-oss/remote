/**
 * @fileoverview The POSIX bootstrap script's probe, install and stepwise install rows, run for real over stand-in tools.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  symlinkSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  statSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {NOISE_LINES} from 'lib-host/testing/noise';
import {
  type BootstrapRequest,
  scriptFor,
  type ScriptParameters,
} from '../../src/index.ts';
import {
  blockOf,
  callsOf,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
  type Stub,
} from './fake-host.ts';
import {
  holdLinkLock,
  installHostHooks,
  lockInTemporaryFolder,
  serverFactsOf,
  statusAndFacts,
  statusOf,
} from './bootstrap-script.fixture.ts';

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
 * Replaces the host's `ln` with one whose first call plays a window that released the lock between this window's
 * `ln` and its check: it removes both names and fails with "File exists". The second call does what `mode` says:
 * `real` links for real, `taken` creates the target as another window would and fails, `refused` fails without a target.
 */
function stubLink(host: FakeHost, mode: 'real' | 'taken' | 'refused'): void {
  const link = path.join(host.tools, 'ln');
  const realLink = readlinkSync(link);
  unlinkSync(link);
  const count = `${host.callsFile}.ln`;
  writeFileSync(
    link,
    [
      '#!/bin/sh',
      `COUNT=$(cat "${count}" 2>/dev/null || echo 0)`,
      `echo $((COUNT + 1)) >"${count}"`,
      'if [ "$COUNT" = 0 ]; then',
      '  rm -f "$1" "$2"',
      '  echo "ln: File exists" >&2',
      '  exit 1',
      'fi',
      mode === 'real' ? `exec "${realLink}" "$@"` : '',
      mode === 'taken' ? 'touch "$2"; echo "ln: File exists" >&2; exit 1' : '',
      mode === 'refused'
        ? 'echo "ln: Operation not permitted" >&2; exit 1'
        : '',
    ].join('\n'),
  );
  chmodSync(link, 0o755);
}

describe('the POSIX bootstrap script', () => {
  let host: FakeHost;
  const useHost = installHostHooks(made => {
    host = made;
  });

  function copiedParameters(removeArchive: boolean): ScriptParameters {
    const parameters = parametersFor();
    parameters.archivePath = path.join(host.home, 'copied.tar.gz');
    copyFileSync(host.archive, parameters.archivePath);
    parameters.removeArchive = removeArchive;
    return parameters;
  }

  it('transport contracts 5.0: the parameter block holds the umask', () => {
    const script = scriptFor(single('probe'), 'posixShell', {
      ...parametersFor(),
      installUmask: '022',
    });
    deepStrictEqual(
      [
        script.includes("INSTALL_UMASK='022'"),
        script.includes(
          '[ "$INSTALL_UMASK" = inherit ] || umask "$INSTALL_UMASK"',
        ),
      ],
      [true, true],
    );
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

    it('ADR-0010: the probe: noise around and inside its stream changes nothing', () => {
      const noise = NOISE_LINES.map(line => `printf '%s\\n' '${line}'`);
      function loud(script: string): string {
        return [...noise, ...noise.map(line => `${line} >&2`), script].join(
          '\n',
        );
      }
      deepStrictEqual(
        blockOf(host, single('probe'), parametersFor(), {
          rewriteScript: loud,
        }),
        blockOf(host, single('probe'), parametersFor()),
      );
    });

    const ARCHITECTURES = [
      ['aarch64', 'arm64'],
      ['arm64', 'arm64'],
      ['armv7l', 'armhf'],
      ['armv8l', 'armhf'],
      ['x86_64', 'x64'],
      ['ppc64le', 'ppc64le'],
      ['riscv64', 'riscv64'],
      ['loongarch64', 'loong64'],
      ['s390x', 's390x'],
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

    for (const machine of ['i686', 'armv6l', 'aarch64_be', 'ppc64']) {
      it(`#670 R1: ${machine} is UnsupportedArch and is reported as written`, () => {
        deepStrictEqual(
          statusAndFacts(
            host,
            single('probe'),
            parametersFor(),
            ['host.arch'],
            {environment: {STUB_UNAME_M: machine}},
          ),
          {status: 'UnsupportedArch', 'host.arch': machine},
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

    for (const [root, folder] of [
      ['~/srv', ['srv', '.server-data', 'bin', 'abc123']],
      ['~', ['.server-data', 'bin', 'abc123']],
    ] as const) {
      it(`F-2407 AC-7 (ruling-1277-tilde): the install root ${root} stands for the host's home folder`, () => {
        deepStrictEqual(
          statusAndFacts(
            host,
            single('probe'),
            {...parametersFor(), installRoot: root},
            ['server.installDir'],
          ),
          {
            status: 'Ok',
            'server.installDir': path.join(host.home, ...folder),
          },
        );
      });
    }

    it('F-2407 AC-7 (ruling-1277-tilde): a ~ that is not the start of the install root stays as written', () => {
      deepStrictEqual(
        statusAndFacts(
          host,
          single('probe'),
          {...parametersFor(), installRoot: '/a/~/b'},
          ['server.installDir'],
        ),
        {status: 'Ok', 'server.installDir': '/a/~/b/.server-data/bin/abc123'},
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

    it('F-0419 AC-37: with installUmask 022, an install given umask 000 makes its folder 0755', () => {
      runScript(
        host,
        single('install'),
        {...parametersFor(), installUmask: '022'},
        {
          rewriteScript: text => `umask 000\n${text}`,
        },
      );
      deepStrictEqual(statSync(installFolder(host)).mode & 0o777, 0o755);
    });

    it('transport contracts 5.0: with installUmask inherit, the install keeps the umask it is given', () => {
      runScript(
        host,
        single('install'),
        {...parametersFor(), installUmask: 'inherit'},
        {
          rewriteScript: text => `umask 000\n${text}`,
        },
      );
      deepStrictEqual(statSync(installFolder(host)).mode & 0o777, 0o777);
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

    const DOWNLOAD_ERRORS: Array<[string, Stub, string, string | undefined]> = [
      ['GNU wget', 'wget', '  HTTP/1.0 404 File not found', '404'],
      [
        'GNU wget after a redirect',
        'wget',
        '  HTTP/1.1 302 Found\n  HTTP/1.1 404 Not Found',
        '404',
      ],
      [
        'BusyBox wget',
        'wget',
        'wget: server returned error: HTTP/1.0 404 File not found',
        '404',
      ],
      [
        'curl',
        'curl',
        'curl: (22) The requested URL returned error: 404',
        '404',
      ],
      [
        'GNU wget on a 503',
        'wget',
        '  HTTP/1.1 503 Service Unavailable',
        undefined,
      ],
      [
        'GNU wget on a 404 after a redirect that ended in a 503',
        'wget',
        '  HTTP/1.1 404 Not Found\n  HTTP/1.1 503 Service Unavailable',
        undefined,
      ],
      [
        'curl on a 503',
        'curl',
        'curl: (22) The requested URL returned error: 503',
        undefined,
      ],
      [
        'curl on a refused connection',
        'curl',
        'curl: (7) Failed to connect',
        undefined,
      ],
    ];
    for (const [name, stub, text, status] of DOWNLOAD_ERRORS) {
      it(`#670 R3: ${name} gives the download status ${status ?? 'nothing'}`, () => {
        useHost([stub]);
        deepStrictEqual(
          statusAndFacts(
            host,
            single('install'),
            parametersFor(),
            ['server.downloadStatus'],
            {environment: {STUB_FETCH_ERROR: text}},
          ),
          {status: 'ServerDownloadFailed', 'server.downloadStatus': status},
        );
      });
    }

    it('R-26: the headers a failed fetch printed, a redirect location with a query included, are in no fact', () => {
      useHost(['wget']);
      const block = blockOf(host, single('install'), parametersFor(), {
        environment: {
          STUB_FETCH_ERROR:
            '  HTTP/1.1 302 Found\n  Location: https://cdn.example/a.tgz?token=SECRET123\n  HTTP/1.1 404 Not Found',
        },
      });
      deepStrictEqual(
        block === 'none'
          ? block
          : JSON.stringify([
              block.hostFacts,
              block.serverFacts,
              block.cliFacts,
            ]).includes('SECRET123'),
        false,
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

    it('#701: a lock released between ln and the holder check is taken on the second try', () => {
      stubLink(host, 'real');
      deepStrictEqual(statusOf(host, single('install'), parametersFor()), 'Ok');
    });

    it('#701: a lock taken by another window during the second try is LockBusy', () => {
      stubLink(host, 'taken');
      deepStrictEqual(
        statusOf(host, single('install'), parametersFor()),
        'LockBusy',
      );
    });

    it('#701: a second ln refused without a holder reports the second error', () => {
      stubLink(host, 'refused');
      deepStrictEqual(
        serverFactsOf(host, single('install'), parametersFor())
          .writeFailedError,
        'ln: Operation not permitted',
      );
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

    it('#668 R4: a busy flock reports the lock file', () => {
      useHost(['wget', 'flock']);
      const parameters = parametersFor();
      parameters.lock.method = 'flock';
      deepStrictEqual(
        serverFactsOf(host, single('install'), parameters, {
          environment: {STUB_FLOCK_BUSY: 'yes'},
        }).lockPath,
        path.join(installFolder(host), 'boot-lock.user.abc123'),
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
});
