import {deepStrictEqual} from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeCliBinFs} from '../../src/cli-bin/node-cli-bin-fs.ts';
import {
  refreshCliBin,
  type CliBinFacts,
  type CliBinFs,
} from '../../src/cli-bin/cli-bin.ts';

const FACTS: CliBinFacts = {
  extensionPath: '/ext/remote-containers',
  appRoot: '/app/resources/app',
  editorPath: '/app/code',
  quality: 'stable',
};

/** A file system in memory: the files by name, and the calls it saw. */
function memoryFs(files: Record<string, string> = {}): {
  disk: CliBinFs;
  files: Record<string, string>;
  calls: string[];
} {
  const calls: string[] = [];
  let counter = 0;
  const disk: CliBinFs = {
    readText: file => Promise.resolve(files[file]),
    makeFolder: folder => {
      calls.push(`mkdir ${folder}`);
      return Promise.resolve();
    },
    writeText: (file, text, mode) => {
      calls.push(`write ${file} ${mode.toString(8)}`);
      files[file] = text;
      return Promise.resolve();
    },
    rename: (from, target) => {
      calls.push(`rename ${from} ${target}`);
      files[target] = files[from] ?? '';
      Reflect.deleteProperty(files, from);
      return Promise.resolve();
    },
    unique: () => {
      counter += 1;
      return String(counter);
    },
  };
  return {disk, files, calls};
}

const FOLDER = '/storage/cli-bin';

describe('the cli-bin folder (card containers-211)', () => {
  it('F-1201 AC-29, BR-15: a missing folder is made and written whole: the launchers, the four data files, nothing else', async () => {
    const {disk, files, calls} = memoryFs();
    await refreshCliBin('/storage', FACTS, disk);
    deepStrictEqual(
      [
        calls.filter(call => call.startsWith('mkdir')),
        Object.keys(files).sort(),
      ],
      [
        ['mkdir /storage/cli-bin'],
        [
          `${FOLDER}/devcontainer`,
          `${FOLDER}/devcontainer.cmd`,
          `${FOLDER}/remote-containers-path`,
          `${FOLDER}/vscode-app-root`,
          `${FOLDER}/vscode-path`,
          `${FOLDER}/vscode-quality`,
        ],
      ],
    );
  });

  it('F-1201 BR-15: the data files hold the paths and the quality, and the launcher is executable', async () => {
    const {disk, files, calls} = memoryFs();
    await refreshCliBin('/storage', FACTS, disk);
    deepStrictEqual(
      [
        files[`${FOLDER}/remote-containers-path`],
        files[`${FOLDER}/vscode-app-root`],
        files[`${FOLDER}/vscode-path`],
        files[`${FOLDER}/vscode-quality`],
        calls
          .filter(call => call.includes('.tmp') && call.startsWith('write'))
          .map(call => call.split(' ').slice(-1)[0]),
      ],
      [
        '/ext/remote-containers',
        '/app/resources/app',
        '/app/code',
        'stable',
        ['755', '755', '644', '644', '644', '644'],
      ],
    );
  });

  it('F-1201 AC-30: nothing is rewritten when nothing changed', async () => {
    const {disk, calls} = memoryFs();
    await refreshCliBin('/storage', FACTS, disk);
    const before = calls.length;
    await refreshCliBin('/storage', FACTS, disk);
    deepStrictEqual(calls.length, before);
  });

  it('F-1201 AC-30: an extension that moved rewrites the launchers and not the editor’s files', async () => {
    const {disk, calls} = memoryFs();
    await refreshCliBin('/storage', FACTS, disk);
    calls.length = 0;
    await refreshCliBin(
      '/storage',
      {...FACTS, extensionPath: '/ext/next'},
      disk,
    );
    deepStrictEqual(
      calls
        .filter(call => call.startsWith('rename'))
        .map(call => call.split(' ')[2]?.slice(FOLDER.length + 1)),
      ['devcontainer', 'devcontainer.cmd', 'remote-containers-path'],
    );
  });

  it('F-1201 BR-15: an editor that moved rewrites the other data files and not the launchers', async () => {
    const {disk, calls} = memoryFs();
    await refreshCliBin('/storage', FACTS, disk);
    calls.length = 0;
    await refreshCliBin('/storage', {...FACTS, editorPath: '/app/next'}, disk);
    deepStrictEqual(
      calls
        .filter(call => call.startsWith('rename'))
        .map(call => call.split(' ')[2]?.slice(FOLDER.length + 1)),
      ['vscode-app-root', 'vscode-quality', 'vscode-path'],
    );
  });

  it('F-1201 BR-15: each key is written after the files it keys, so a refresh that stops half way is made again', async () => {
    const {disk, calls} = memoryFs();
    await refreshCliBin('/storage', FACTS, disk);
    const renamed = calls
      .filter(call => call.startsWith('rename'))
      .map(call => call.split(' ')[2]?.slice(FOLDER.length + 1));
    deepStrictEqual(
      [
        renamed.indexOf('remote-containers-path') >
          renamed.indexOf('devcontainer.cmd'),
        renamed.indexOf('vscode-path') > renamed.indexOf('vscode-quality'),
      ],
      [true, true],
    );
  });

  it('F-1201 BR-16: an insider product names its launchers devcontainer-insiders', async () => {
    const {disk, files} = memoryFs();
    await refreshCliBin('/storage', {...FACTS, quality: 'insider'}, disk);
    deepStrictEqual(
      Object.keys(files)
        .filter(name => name.includes('devcontainer-insiders'))
        .sort(),
      [
        `${FOLDER}/devcontainer-insiders`,
        `${FOLDER}/devcontainer-insiders.cmd`,
      ],
    );
  });

  it('F-1201 BR-15: every file is written under a temporary name of its own and renamed', async () => {
    const {disk, calls} = memoryFs();
    await refreshCliBin('/storage', FACTS, disk);
    const writes = calls
      .filter(call => call.startsWith('write'))
      .map(call => call.split(' ')[1] ?? '');
    deepStrictEqual(
      [
        writes.every(file => file.endsWith('.tmp')),
        new Set(writes).size === writes.length,
      ],
      [true, true],
    );
  });
});

describe('the cli-bin folder on a disk (card containers-211)', () => {
  it('F-1201 BR-15: a folder that was open to the others is closed to them when it is refreshed', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cli-bin-'));
    try {
      mkdirSync(path.join(root, 'cli-bin'), {mode: 0o755});
      await refreshCliBin(root, FACTS, nodeCliBinFs);
      deepStrictEqual(statSync(path.join(root, 'cli-bin')).mode & 0o777, 0o700);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it('F-1201 AC-29, AC-30: a refresh on a real folder writes the launchers executable and the folder for the user only, and a second leaves every file as it was', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cli-bin-'));
    try {
      await refreshCliBin(root, FACTS, nodeCliBinFs);
      const folder = path.join(root, 'cli-bin');
      const names = readdirSync(folder).sort();
      const before = names.map(
        name => statSync(path.join(folder, name)).mtimeMs,
      );
      await refreshCliBin(root, FACTS, nodeCliBinFs);
      deepStrictEqual(
        [
          names,
          statSync(folder).mode & 0o777,
          statSync(path.join(folder, 'devcontainer')).mode & 0o777,
          readFileSync(path.join(folder, 'vscode-path'), 'utf8'),
          names.map(name => statSync(path.join(folder, name)).mtimeMs),
        ],
        [
          [
            'devcontainer',
            'devcontainer.cmd',
            'remote-containers-path',
            'vscode-app-root',
            'vscode-path',
            'vscode-quality',
          ],
          0o700,
          0o755,
          '/app/code',
          before,
        ],
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
