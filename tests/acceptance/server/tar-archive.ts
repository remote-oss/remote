/**
 * @fileoverview A small tar writer for the acceptance fixtures: a gzip-compressed ustar archive of regular files,
 * byte for byte the same on every run, so that a test never depends on the `tar` of the machine that built it.
 */

import {gzipSync} from 'node:zlib';

/** One regular file of an archive. */
export interface ArchiveFile {
  /** The path inside the archive, at most 100 characters. */
  path: string;
  content: string;
  /** The permission bits, for example 0o755. */
  mode: number;
}

const BLOCK_SIZE = 512;

const NAME_LENGTH = 100;

/** Writes `value` into `block` at `offset` as ASCII, padded with zero bytes up to `length`. */
function writeText(
  block: Buffer,
  offset: number,
  length: number,
  value: string,
): void {
  block.write(value, offset, length, 'ascii');
}

/** A number as the octal text of a header field of `length` bytes, with its terminating zero byte. */
function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0');
}

/** The header block of one file. */
function headerOf(file: ArchiveFile, size: number): Buffer {
  if (file.path.length > NAME_LENGTH) {
    throw new RangeError(
      `the path '${file.path}' is longer than ${String(NAME_LENGTH)} characters`,
    );
  }
  const block = Buffer.alloc(BLOCK_SIZE);
  writeText(block, 0, NAME_LENGTH, file.path);
  writeText(block, 100, 8, octal(file.mode, 8));
  writeText(block, 108, 8, octal(0, 8));
  writeText(block, 116, 8, octal(0, 8));
  writeText(block, 124, 12, octal(size, 12));
  writeText(block, 136, 12, octal(0, 12));
  // The checksum is computed with its own field read as spaces.
  writeText(block, 148, 8, '        ');
  writeText(block, 156, 1, '0');
  writeText(block, 257, 6, 'ustar');
  writeText(block, 263, 2, '00');
  const checksum = block.reduce((total, byte) => total + byte, 0);
  writeText(block, 148, 8, `${octal(checksum, 7)} `);
  return block;
}

/** The files as a gzip-compressed tar archive. */
export function tarGzip(files: readonly ArchiveFile[]): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const content = Buffer.from(file.content, 'utf8');
    blocks.push(headerOf(file, content.length), content);
    const padding = (BLOCK_SIZE - (content.length % BLOCK_SIZE)) % BLOCK_SIZE;
    blocks.push(Buffer.alloc(padding));
  }
  // An archive ends with two empty blocks.
  blocks.push(Buffer.alloc(2 * BLOCK_SIZE));
  return gzipSync(Buffer.concat(blocks), {level: 9});
}
