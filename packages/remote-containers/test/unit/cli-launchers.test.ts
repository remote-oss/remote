import {deepStrictEqual} from 'node:assert';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  EDITOR_PATH_FILE,
  EXTENSION_PATH_FILE,
  POSIX_LAUNCHER,
  WINDOWS_LAUNCHER,
} from '../../src/cli-bin/launcher-scripts.ts';

describe('the launchers of cli-bin (card containers-211)', () => {
  let root = '';
  let launcher = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'launcher-'));
    const folder = path.join(root, 'cli bin');
    mkdirSync(folder);
    launcher = path.join(folder, 'devcontainer');
    writeFileSync(launcher, POSIX_LAUNCHER, {mode: 0o755});
    const editor = path.join(root, 'editor');
    writeFileSync(
      editor,
      '#!/bin/sh\nprintf "%s\\n" "$ELECTRON_RUN_AS_NODE"\nprintf "%s\\n" "$REMOTE_OSS_EDITOR_PROGRAM"\nfor each in "$@"; do printf "%s\\n" "$each"; done\n',
    );
    chmodSync(editor, 0o755);
    writeFileSync(path.join(folder, EDITOR_PATH_FILE), editor);
    writeFileSync(
      path.join(folder, EXTENSION_PATH_FILE),
      '/ext/remote containers',
    );
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  const ARGUMENTS = ['open', 'a b', 'x&y', '$HOME', "q'uote"];
  function expected(): string[] {
    return [
      '1',
      path.join(root, 'editor'),
      '/ext/remote containers/dist/cli-launcher.js',
      ...ARGUMENTS,
    ];
  }

  function output(command: string): string[] {
    return execFileSync(command, ARGUMENTS, {encoding: 'utf8'})
      .split('\n')
      .slice(0, -1);
  }

  it('F-1201 BR-15, BR-16: the POSIX launcher runs the editor’s program as a Node on the launcher program with every argument as it came', () => {
    deepStrictEqual(output(launcher), expected());
  });

  it('F-1201 AC-29: a link to the launcher, absolute or relative, in a folder of its own or a chain of links, finds the data files beside the launcher', () => {
    const links = path.join(root, 'links');
    mkdirSync(links);
    symlinkSync(launcher, path.join(links, 'absolute'));
    symlinkSync(path.relative(links, launcher), path.join(links, 'relative'));
    symlinkSync('absolute', path.join(links, 'chain'));
    deepStrictEqual(
      ['absolute', 'relative', 'chain'].map(name =>
        output(path.join(links, name)),
      ),
      [expected(), expected(), expected()],
    );
  });

  it('F-1201 AC-29: a link that points at itself ends the search after a bounded number of hops instead of looping', () => {
    const loop = path.join(root, 'loop');
    symlinkSync('loop', loop);
    const result = spawnSync(launcher, ['open'], {encoding: 'utf8'});
    const looped = spawnSync(loop, ['open'], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    deepStrictEqual(
      [result.status, looped.signal, looped.status !== 0],
      [0, null, true],
    );
  });

  it('F-1201 BR-15: the POSIX launcher holds no path and the Windows launcher passes %* on, quoting nothing again', () => {
    deepStrictEqual(
      [
        POSIX_LAUNCHER.includes(root),
        POSIX_LAUNCHER.startsWith('#!/usr/bin/env sh\n'),
        WINDOWS_LAUNCHER.includes('%*'),
        WINDOWS_LAUNCHER.split('\r\n').every(line => !line.includes('\n')),
        WINDOWS_LAUNCHER.includes(`%~dp0${EDITOR_PATH_FILE}`),
      ],
      [false, true, true, true, true],
    );
  });
});
