import {deepStrictEqual} from 'node:assert';
import {
  ELF_MACHINE_OFFSET,
  nodeEntryOf,
  otherMachine,
  topFolderOf,
  withElfMachine,
} from '../tests/acceptance/windows/foreign-archive.ts';

/** The start of a little-endian x86-64 ELF file: the magic, class, data, version, padding and the machine. */
function elfHeader(machine: number[]): Buffer {
  const header = Buffer.alloc(64);
  header.write('\u007fELF', 0, 'latin1');
  header[4] = 2;
  header[5] = 1;
  header[6] = 1;
  header[ELF_MACHINE_OFFSET] = machine[0] ?? 0;
  header[ELF_MACHINE_OFFSET + 1] = machine[1] ?? 0;
  return header;
}

/** The message of the failure `action` ends with, or `none`. */
function failureOf(action: () => unknown): string {
  try {
    action();
    return 'none';
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

describe('the server archive of another architecture (card #2948, F-2406 AC-13)', () => {
  it('#2948: the machine to write is AArch64 on an x64 machine and x86-64 on any other', () => {
    deepStrictEqual(
      [otherMachine('x64'), otherMachine('arm64'), otherMachine('arm')].map(
        bytes => [...bytes],
      ),
      [
        [0xb7, 0x00],
        [0x3e, 0x00],
        [0x3e, 0x00],
      ],
    );
  });

  it('#2948: an ELF header gets the other machine in the two bytes at offset 18 and nothing else changes', () => {
    const header = elfHeader([0x3e, 0x00]);
    const patched = withElfMachine(header, otherMachine('x64'));
    const changed = [...patched].flatMap((byte, index) =>
      byte === header[index] ? [] : [index],
    );
    deepStrictEqual(
      [[...patched.subarray(18, 20)], changed, [...header.subarray(18, 20)]],
      [[0xb7, 0x00], [18], [0x3e, 0x00]],
    );
  });

  it('#2948, negative: a file that is no ELF, a big-endian one or one cut short is refused, naming why', () => {
    const bigEndian = elfHeader([0x3e, 0x00]);
    bigEndian[5] = 2;
    function refused(header: Buffer): string {
      return failureOf(() => withElfMachine(header, otherMachine('x64')));
    }
    deepStrictEqual(
      [
        refused(Buffer.from('#!/bin/sh\n'.repeat(8))),
        refused(bigEndian),
        refused(elfHeader([0x3e, 0x00]).subarray(0, 12)),
      ],
      [
        'the file does not start with an ELF header',
        'the ELF file is not little-endian, so its machine field is not these two bytes',
        'the file does not start with an ELF header',
      ],
    );
  });

  it('#2948: the node entry is found at the root of the archive or inside a top folder, and exactly one is needed', () => {
    deepStrictEqual(
      [
        nodeEntryOf(['bin/', 'node', 'bin/server.sh']),
        nodeEntryOf([
          './top/',
          './top/node',
          './top/node_modules/x',
          './top/out/main.js',
        ]),
        failureOf(() => nodeEntryOf(['a/node', 'b/node'])).slice(0, 38),
        failureOf(() => nodeEntryOf(['a/nodes', 'a/x'])).slice(0, 38),
      ],
      [
        'node',
        './top/node',
        'the archive lists 2 entries named node',
        'the archive lists 0 entries named node',
      ],
    );
  });

  it('#2948: an archive whose entries all sit in one top folder says which, and one with entries at its root says none', () => {
    deepStrictEqual(
      [
        topFolderOf(['./', './vscode-server/', './vscode-server/node']),
        topFolderOf(['vscode-server/node', 'vscode-server/bin/x']),
        topFolderOf(['node', 'bin/server.sh']),
        topFolderOf(['a/x', 'b/y']),
      ],
      ['vscode-server', 'vscode-server', undefined, undefined],
    );
  });
});
