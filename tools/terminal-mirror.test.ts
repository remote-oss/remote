import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  terminalMirrorLines,
  terminalMirrorText,
} from '../tests/acceptance/windows/terminal-mirror.ts';

describe('the harness reader of the terminal mirror (card tooling-199, #2361)', () => {
  it('strips colour codes and turns the line ends to \\n, an empty middle line kept', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
    try {
      const file = path.join(folder, 'mirror.txt');
      writeFileSync(file, '\u001b[31mrefused\u001b[0m\r\nplain\r\n\r\nend');
      deepStrictEqual(
        [terminalMirrorText(file), terminalMirrorLines(file)],
        ['refused\nplain\n\nend', ['refused', 'plain', '', 'end']],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('an empty file reads as empty text and no lines', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
    try {
      const file = path.join(folder, 'empty.txt');
      writeFileSync(file, '');
      deepStrictEqual(
        [terminalMirrorText(file), terminalMirrorLines(file)],
        ['', []],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('a file not there yet reads as empty text and no lines', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
    try {
      deepStrictEqual(
        [
          terminalMirrorText(path.join(folder, 'absent.txt')),
          terminalMirrorLines(path.join(folder, 'absent.txt')),
        ],
        ['', []],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
