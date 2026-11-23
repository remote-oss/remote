import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  listedDistros,
  MINIROOTFS,
  prepareRunDistros,
  runDistros,
  staleDistros,
  sweepRunDistros,
  wslText,
} from './acceptance-wsl.ts';
import type {CommandResult} from './command-runner.ts';

/** wsl.exe's text as it reaches Node without WSL_UTF8: UTF-16LE read as UTF-8, a NUL after each character. */
function utf16(text: string): string {
  return Buffer.from(text, 'utf16le').toString('utf8');
}

/** A command runner that records each call and answers from `answers`, by the call's first argument. */
function recording(answers: Readonly<Record<string, CommandResult>> = {}): {
  calls: string[][];
  command: (
    program: string,
    programArguments: readonly string[],
  ) => CommandResult;
} {
  const calls: string[][] = [];
  return {
    calls,
    command: (program, programArguments) => {
      calls.push([program, ...programArguments]);
      const key = `${programArguments[0] ?? ''} ${programArguments[1] ?? ''}`;
      return answers[key] ?? {status: 0, stdout: '', stderr: ''};
    },
  };
}

const ROOTFS = Buffer.from('a minirootfs');
const PINNED = {
  url: 'https://example.invalid/minirootfs.tar.gz',
  sha256: createHash('sha256').update(ROOTFS).digest('hex'),
};

describe('the wsl launch’s distros (card #2355)', () => {
  let runFolder: string;

  beforeEach(() => {
    runFolder = mkdtempSync(path.join(tmpdir(), 'wsl-distros-'));
  });

  afterEach(() => {
    rmSync(runFolder, {recursive: true, force: true});
  });

  it('#2355: a run’s own distros are named after it, and the installed one is the job’s Ubuntu', () => {
    deepStrictEqual(runDistros('43563264896-1-windows'), {
      installed: 'Ubuntu-24.04',
      wsl2: 'acceptance-43563264896-1-windows-wsl2',
      wsl1: 'acceptance-43563264896-1-windows-wsl1',
    });
  });

  it('#2355: wsl.exe’s list reads the same as UTF-16LE with a byte-order mark and CR LF as it does as UTF-8, with the default marked', () => {
    const table =
      '  NAME            STATE           VERSION\n* Ubuntu-24.04    Running         2\n  acceptance-r-wsl1   Stopped     1\n\n';
    const expected = [
      {name: 'Ubuntu-24.04', version: '2', isDefault: true},
      {name: 'acceptance-r-wsl1', version: '1', isDefault: false},
    ];
    deepStrictEqual(
      [
        listedDistros(
          wslText(
            utf16(String.fromCharCode(0xfeff) + table.replaceAll('\n', '\r\n')),
          ),
        ),
        listedDistros(wslText(table)),
      ],
      [expected, expected],
    );
  });

  it('#2355: only a distro whose name starts with acceptance- counts as a run’s', () => {
    deepStrictEqual(
      staleDistros([
        {name: 'Ubuntu-24.04', version: '2', isDefault: true},
        {name: 'acceptance-r-wsl2', version: '2', isDefault: false},
        {name: 'my-acceptance-distro', version: '2', isDefault: false},
      ]),
      ['acceptance-r-wsl2'],
    );
  });

  it('#2355: a client that is not Windows is refused before anything is downloaded or imported', async () => {
    const world = recording();
    const downloads: string[] = [];
    const refused = await prepareRunDistros(
      world.command,
      'linux',
      runFolder,
      'r',
      PINNED,
      url => {
        downloads.push(url);
        return Promise.resolve(ROOTFS);
      },
      () => undefined,
    ).then(
      () => 'prepared',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    );
    deepStrictEqual(
      [refused, downloads, world.calls],
      [
        "the wsl launch needs a Windows client with WSL; this run's client is linux",
        [],
        [],
      ],
    );
  });

  it('#2355: a minirootfs whose digest is not its pin is refused before any import', async () => {
    const world = recording();
    const refused = await prepareRunDistros(
      world.command,
      'win32',
      runFolder,
      'r',
      {...PINNED, sha256: 'ab'.repeat(32)},
      () => Promise.resolve(ROOTFS),
      () => undefined,
    ).then(
      () => 'prepared',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    );
    deepStrictEqual([refused.includes('not its pin'), world.calls], [true, []]);
  });

  it('#2355: the minirootfs is imported at WSL 2 and WSL 1 into the run folder, and the unregister step removes both', async () => {
    const world = recording();
    const prepared = await prepareRunDistros(
      world.command,
      'win32',
      runFolder,
      'r',
      PINNED,
      () => Promise.resolve(ROOTFS),
      () => undefined,
    );
    const rootfs = path.join(runFolder, 'wsl', 'alpine-minirootfs.tar.gz');
    const imports = [...world.calls];
    await prepared.unregister();
    deepStrictEqual(
      {
        distros: prepared.distros,
        rootfs: existsSync(rootfs) ? readFileSync(rootfs).toString() : '',
        imports,
        unregisters: world.calls.slice(imports.length),
      },
      {
        distros: runDistros('r'),
        rootfs: 'a minirootfs',
        imports: [
          [
            'wsl.exe',
            '--import',
            'acceptance-r-wsl2',
            path.join(runFolder, 'wsl', 'acceptance-r-wsl2'),
            rootfs,
            '--version',
            '2',
          ],
          [
            'wsl.exe',
            '--import',
            'acceptance-r-wsl1',
            path.join(runFolder, 'wsl', 'acceptance-r-wsl1'),
            rootfs,
            '--version',
            '1',
          ],
        ],
        unregisters: [
          ['wsl.exe', '--unregister', 'acceptance-r-wsl2'],
          ['wsl.exe', '--unregister', 'acceptance-r-wsl1'],
        ],
      },
    );
  });

  it('#2355: a WSL 1 import that fails unregisters the WSL 2 distro already imported, and the run fails with the import’s error', async () => {
    const world = recording({
      '--import acceptance-r-wsl1': {
        status: 1,
        stdout: '',
        stderr: 'WSL 1 is not supported',
      },
    });
    const failed = await prepareRunDistros(
      world.command,
      'win32',
      runFolder,
      'r',
      PINNED,
      () => Promise.resolve(ROOTFS),
      () => undefined,
    ).then(
      () => 'prepared',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    );
    deepStrictEqual(
      [
        failed.includes('WSL 1 is not supported'),
        world.calls.map(call => call.slice(1, 3)),
      ],
      [
        true,
        [
          ['--import', 'acceptance-r-wsl2'],
          ['--import', 'acceptance-r-wsl1'],
          ['--unregister', 'acceptance-r-wsl2'],
        ],
      ],
    );
  });

  it('#2355: an unregister that fails is reported with wsl.exe’s words and does not throw, so the run’s later stops still run', async () => {
    const world = recording({
      '--unregister acceptance-r-wsl2': {
        status: 1,
        stdout: '',
        stderr: utf16('The distribution is busy.\r\n'),
      },
    });
    const lines: string[] = [];
    const prepared = await prepareRunDistros(
      world.command,
      'win32',
      runFolder,
      'r',
      PINNED,
      () => Promise.resolve(ROOTFS),
      line => {
        lines.push(line);
      },
    );
    await prepared.unregister();
    deepStrictEqual(lines, [
      'acceptance: wsl.exe --unregister acceptance-r-wsl2 failed (1): The distribution is busy.',
    ]);
  });

  it('#2355: the clean-up unregisters the distros its run left on Windows and names, but keeps, another run’s', () => {
    const world = recording({
      '-l -v': {
        status: 0,
        stdout: utf16(
          '  NAME   STATE   VERSION\r\n* Ubuntu-24.04   Running   2\r\n  acceptance-r-wsl1   Stopped   1\r\n  acceptance-r2-wsl2   Stopped   2\r\n',
        ),
        stderr: '',
      },
    });
    const lines: string[] = [];
    deepStrictEqual(
      [
        sweepRunDistros(world.command, 'win32', 'r', line => {
          lines.push(line);
        }),
        world.calls,
        lines,
      ],
      [
        ['acceptance-r-wsl1'],
        [
          ['wsl.exe', '-l', '-v'],
          ['wsl.exe', '--unregister', 'acceptance-r-wsl1'],
        ],
        [
          'acceptance: unregistered acceptance-r-wsl1, a WSL distro this run left',
          'acceptance: the WSL distros of other runs stay: acceptance-r2-wsl2 (wsl.exe --unregister <name> removes one)',
        ],
      ],
    );
  });

  it('#2355: the clean-up does nothing on a Windows client that lists no distro, nor on another platform', () => {
    const empty = recording({
      '-l -v': {
        status: 4294967295,
        stdout: utf16(
          'Windows Subsystem for Linux has no installed distributions.\r\n',
        ),
        stderr: '',
      },
    });
    const elsewhere = recording();
    const lines: string[] = [];
    function report(line: string): void {
      lines.push(line);
    }
    deepStrictEqual(
      [
        sweepRunDistros(empty.command, 'win32', 'r', report),
        empty.calls,
        sweepRunDistros(elsewhere.command, 'linux', 'r', report),
        elsewhere.calls,
        lines,
      ],
      [[], [['wsl.exe', '-l', '-v']], [], [], []],
    );
  });

  it('#2355: the pinned minirootfs is #2348’s Alpine 3.24.4, by its digest', () => {
    deepStrictEqual(MINIROOTFS, {
      url: 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-minirootfs-3.24.4-x86_64.tar.gz',
      sha256:
        'cdaa38cb8de3537967ee5b6c9b6cd00cc962da2b018e6eea48696bb274923012',
    });
  });
});
