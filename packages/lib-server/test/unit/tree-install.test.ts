import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {scriptFor} from '../../src/index.ts';
import {
  blockOf,
  callsOf,
  fakeHost,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';

/** The commit folder of the baseline parameters, and the epoch suffix of their staging siblings. */
const COMMIT = 'abc123';
const SUFFIX = '1700000000000';

/** The launcher the tree must hold for it to be complete. */
const LAUNCHER = 'bin/launcher';

/** The shared tree of a commit on the fake host's volume. */
function treeOf(host: FakeHost, commit = COMMIT): string {
  return path.join(host.home, 'volume', 'bin', 'linux-x64', commit);
}

/** The baseline parameters with a tree and a client-placed archive, and a lock name no other host shares. */
function treeParameters(host: FakeHost, archive = host.archive) {
  const parameters = parametersFor();
  parameters.installTree = treeOf(host);
  parameters.archivePath = archive;
  parameters.lock.filePrefix = `boot-lock.${path.basename(path.dirname(host.home))}`;
  return parameters;
}

/** The facts the server reported in a step. */
function serverFacts(
  host: FakeHost,
  step: Parameters<typeof single>[0],
  parameters = treeParameters(host),
): Record<string, string> {
  const block = blockOf(host, single(step), parameters);
  return block === 'none' ? {} : block.serverFacts;
}

/** The status of a step. */
function statusOf(
  host: FakeHost,
  step: Parameters<typeof single>[0],
  parameters = treeParameters(host),
): string {
  const block = blockOf(host, single(step), parameters);
  return block === 'none' ? 'none' : block.status;
}

/** Puts a complete server into `folder`. */
function completeServer(folder: string, marker = 'launcher'): void {
  mkdirSync(path.join(folder, 'bin'), {recursive: true});
  writeFileSync(path.join(folder, LAUNCHER), `#!/bin/sh\n# ${marker}\n`);
  chmodSync(path.join(folder, LAUNCHER), 0o755);
}

/** The real `tar`, found on the machine. */
function realTar(host: FakeHost): string {
  return readlinkSync(path.join(host.tools, 'tar'));
}

/**
 * Replaces `tar` with a stand-in that records each call and the entries of the tree's parent folder, and runs the real
 * one. With `afterExtract`, a complete server is put at the tree once the extraction has run.
 */
function recordingTar(host: FakeHost, afterExtract = ''): string {
  const listing = path.join(host.home, 'tar-listing.txt');
  const real = realTar(host);
  const tarFile = path.join(host.tools, 'tar');
  rmSync(tarFile);
  writeFileSync(
    tarFile,
    [
      '#!/bin/sh',
      'echo "tar $*" >>"$STUB_LOG"',
      `echo "[$(ls '${path.dirname(treeOf(host))}' | tr '\\n' ' ')]" >>'${listing}'`,
      `'${real}' "$@"`,
      'STATUS=$?',
      afterExtract === ''
        ? ''
        : `[ "$1" != -xzvf ] || { mkdir -p '${afterExtract}/bin'; printf '#!/bin/sh\\n# winner\\n' >'${afterExtract}/${LAUNCHER}'; chmod 755 '${afterExtract}/${LAUNCHER}'; }`,
      'exit $STATUS',
    ].join('\n'),
  );
  chmodSync(tarFile, 0o755);
  return listing;
}

/** The entries of a folder, sorted. */
function entries(folder: string): string[] {
  return existsSync(folder) ? readdirSync(folder).sort() : [];
}

describe('the install into a shared tree (card containers-05)', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = fakeHost();
  });

  afterEach(() => {
    runScript(host, single('kill'), treeParameters(host));
  });

  it('F-0503 AC-5: an install into an empty tree is Ok and leaves a complete tree', () => {
    deepStrictEqual(
      [
        statusOf(host, 'install'),
        existsSync(path.join(treeOf(host), LAUNCHER)),
      ],
      ['Ok', true],
    );
  });

  it('F-0503 AC-5: bin/<commit> is a symbolic link to the tree, made now', () => {
    const facts = serverFacts(host, 'install');
    deepStrictEqual(
      [
        facts.treeInstalled,
        facts.installLink,
        lstatSync(installFolder(host)).isSymbolicLink(),
        readlinkSync(installFolder(host)),
      ],
      ['yes', 'made', true, treeOf(host)],
    );
  });

  it('F-0503 BR-6: the unpack goes into a sibling named with an underscore and the epoch, and only the finished tree is named as the commit', () => {
    const listing = recordingTar(host);
    runScript(host, single('install'), treeParameters(host));
    const seen = readFileSync(listing, 'utf8').split('\n').filter(Boolean);
    deepStrictEqual(
      [
        seen.every(
          line =>
            line.includes(`${COMMIT}_${SUFFIX}`) &&
            !line.split(/[[\] ]/).includes(COMMIT),
        ),
        entries(path.dirname(treeOf(host))),
      ],
      [true, [COMMIT]],
    );
  });

  it('F-0503 AC-25: a partial sibling of an interrupted install is neither reused nor removed', () => {
    const leftover = `${treeOf(host)}_1600000000000`;
    mkdirSync(path.join(leftover, 'bin'), {recursive: true});
    writeFileSync(path.join(leftover, 'partial'), 'half');
    deepStrictEqual(
      [
        statusOf(host, 'install'),
        existsSync(path.join(treeOf(host), LAUNCHER)),
        readFileSync(path.join(leftover, 'partial'), 'utf8'),
      ],
      ['Ok', true, 'half'],
    );
  });

  it('F-0503 BR-6: an archive that does not unpack is UnpackFailed, leaves its sibling and makes neither tree nor link', () => {
    const broken = path.join(host.home, 'broken.tar.gz');
    writeFileSync(broken, 'not an archive');
    const parameters = treeParameters(host, broken);
    deepStrictEqual(
      [
        statusOf(host, 'install', parameters),
        existsSync(treeOf(host)),
        existsSync(`${treeOf(host)}_${SUFFIX}`),
        existsSync(installFolder(host)),
      ],
      ['UnpackFailed', false, true, false],
    );
  });

  it('F-0503 BR-6: an archive without the launcher is UnpackFailed and leaves neither a tree nor a link', () => {
    const source = path.join(host.home, 'no-launcher');
    mkdirSync(path.join(source, 'server'), {recursive: true});
    writeFileSync(path.join(source, 'server', 'product.json'), '{}');
    const archive = path.join(host.home, 'no-launcher.tar.gz');
    spawnSync('tar', ['-czf', archive, '-C', source, 'server']);
    deepStrictEqual(
      [
        statusOf(host, 'install', treeParameters(host, archive)),
        existsSync(treeOf(host)),
        existsSync(installFolder(host)),
      ],
      ['UnpackFailed', false, false],
    );
  });

  it('containers-05 R5: a real folder without a launcher at bin/<commit> is replaced by the link', () => {
    runScript(host, single('install'), treeParameters(host));
    rmSync(installFolder(host));
    mkdirSync(installFolder(host));
    writeFileSync(path.join(installFolder(host), 'junk'), 'x');
    const facts = serverFacts(host, 'install');
    deepStrictEqual(
      [facts.installLink, readlinkSync(installFolder(host))],
      ['made', treeOf(host)],
    );
  });

  it('containers-05 R4: an incomplete folder at the tree makes the install UnpackFailed and leaves no sibling inside it', () => {
    mkdirSync(path.join(treeOf(host), 'bin'), {recursive: true});
    deepStrictEqual(
      [statusOf(host, 'install'), entries(treeOf(host))],
      ['UnpackFailed', ['bin']],
    );
  });

  it('F-0503 AC-7: a second data folder on the same volume reads no archive and links to the same tree', () => {
    runScript(host, single('install'), treeParameters(host));
    const listing = recordingTar(host);
    const second = treeParameters(host);
    second.dataFolderName = '.other-data';
    const facts = serverFacts(host, 'install', second);
    deepStrictEqual(
      [
        facts.treeInstalled,
        callsOf(host).filter(call => call.startsWith('tar')),
        existsSync(listing),
        readlinkSync(path.join(host.home, '.other-data', 'bin', COMMIT)),
      ],
      ['no', [], false, treeOf(host)],
    );
  });

  it('containers-05 R4: a complete tree that another container put in place meanwhile is kept, and the own sibling is removed', () => {
    recordingTar(host, treeOf(host));
    runScript(host, single('install'), treeParameters(host));
    deepStrictEqual(
      [
        readFileSync(path.join(treeOf(host), LAUNCHER), 'utf8').includes(
          'winner',
        ),
        entries(path.dirname(treeOf(host))),
      ],
      [true, [COMMIT]],
    );
  });

  it('F-0503 BR-3: a link to another folder is replaced by a link to the tree', () => {
    runScript(host, single('install'), treeParameters(host));
    rmSync(installFolder(host));
    symlinkSync(path.join(host.home, 'elsewhere'), installFolder(host));
    const facts = serverFacts(host, 'install');
    deepStrictEqual(
      [facts.installLink, readlinkSync(installFolder(host))],
      ['made', treeOf(host)],
    );
  });

  it('F-0503 BR-3: a link that already targets the tree is kept as it is', () => {
    runScript(host, single('install'), treeParameters(host));
    const before = lstatSync(installFolder(host)).ino;
    const facts = serverFacts(host, 'install');
    deepStrictEqual(
      [facts.installLink, lstatSync(installFolder(host)).ino],
      ['kept', before],
    );
  });

  it('containers-05 R5: a real, complete folder at bin/<commit> is left as it is', () => {
    runScript(host, single('install'), {
      ...parametersFor(),
      archivePath: host.archive,
    });
    const facts = serverFacts(host, 'install');
    deepStrictEqual(
      [
        facts.installLink,
        lstatSync(installFolder(host)).isDirectory(),
        lstatSync(installFolder(host)).isSymbolicLink(),
      ],
      ['realFolder', true, false],
    );
  });

  it('F-0503 AC-1: a start in a new container on a complete tree makes the link first and reads no archive', () => {
    runScript(host, single('install'), treeParameters(host));
    rmSync(installFolder(host));
    recordingTar(host);
    const parameters = treeParameters(host);
    const status = statusOf(host, 'start', parameters);
    deepStrictEqual(
      [
        status,
        readlinkSync(installFolder(host)),
        callsOf(host).filter(call => call.startsWith('tar')),
      ],
      ['Ok', treeOf(host), []],
    );
  });

  it('containers-05 R6: neither the install nor the start writes a lock file into the shared tree', () => {
    runScript(host, single('install'), treeParameters(host));
    const afterInstall = entries(treeOf(host));
    statusOf(host, 'start');
    deepStrictEqual(
      [afterInstall, entries(treeOf(host))],
      [
        ['bin', 'files', 'product.json'],
        ['bin', 'files', 'product.json'],
      ],
    );
  });

  it('containers-05 R8: the cleanup removes the links of other commits and never their trees', () => {
    const others = ['a'.repeat(40), 'b'.repeat(40)];
    mkdirSync(path.join(host.home, '.server-data', 'bin'), {recursive: true});
    for (const commit of others) {
      completeServer(treeOf(host, commit));
      symlinkSync(
        treeOf(host, commit),
        path.join(host.home, '.server-data', 'bin', commit),
      );
    }
    const parameters = treeParameters(host);
    parameters.cleanup = {kind: 'onlyCurrentKeepLeftovers'};
    runScript(host, single('cleanup'), parameters);
    deepStrictEqual(
      [
        entries(path.join(host.home, '.server-data', 'bin')),
        others.map(commit => entries(treeOf(host, commit))),
      ],
      [[], [['bin'], ['bin']]],
    );
  });

  it('F-0503 BR-4: the probe reports whether the tree is complete', () => {
    const before = serverFacts(host, 'probe').treeComplete;
    runScript(host, single('install'), treeParameters(host));
    deepStrictEqual(
      [before, serverFacts(host, 'probe').treeComplete],
      ['no', 'yes'],
    );
  });
});

describe('the scripts of a server without a tree (card containers-05)', () => {
  const NO_TREE_NAMES = [
    'ensure_install_link',
    'install_tree',
    'server.treeComplete',
    'server.treeInstalled',
    'server.installLink',
  ];

  for (const step of ['probe', 'install', 'start', 'cleanup'] as const) {
    it(`containers-05 R1: the ${step} script of an install in the data folder names no tree, apart from the two lines of the parameter`, () => {
      const text = scriptFor(single(step), 'posixShell', parametersFor());
      deepStrictEqual(
        [
          NO_TREE_NAMES.filter(name => text.includes(name)),
          text.split('\n').filter(line => line.includes('INSTALL_TREE')),
        ],
        [
          [],
          [
            "INSTALL_TREE=''",
            '[ -z "$INSTALL_TREE" ] || LOCK_IN_TEMPORARY=yes',
          ],
        ],
      );
    });
  }

  for (const [useHostProxy, count] of [
    [true, 1],
    [false, 0],
  ] as const) {
    it(`F-0503 BR-18: the start script of useHostProxy ${String(useHostProxy)} holds the option ${String(count)} time`, () => {
      const parameters = parametersFor();
      parameters.start.useHostProxy = useHostProxy;
      const text = scriptFor(single('start'), 'posixShell', parameters);
      deepStrictEqual(text.split("'--use-host-proxy'").length - 1, count);
    });
  }
});
