/**
 * @fileoverview The pieces of a tar archive that holds one regular file, written by hand because Node has no tar
 * writer and a server archive of tens of megabytes cannot be buffered: a 512-byte ustar header, the file's bytes
 * (the caller streams them), and the padding and the two zero blocks that end the archive.
 */

const BLOCK = 512;

/** The longest name a ustar header holds in its name field. */
const NAME_LIMIT = 100;

/** The largest size the header's eleven octal digits hold: 8 GiB minus 1. */
const SIZE_LIMIT = 8 ** 11 - 1;

/** Writes `text` at `offset` of `header`, as ASCII. */
function writeAscii(header: Buffer, offset: number, text: string): void {
  header.write(text, offset, 'ascii');
}

/** A number in octal, padded with zeros to `digits`, then a NUL. */
function octal(value: number, digits: number): string {
  return `${value.toString(8).padStart(digits, '0')}\0`;
}

/** The sum of the header's bytes, with its checksum field read as eight spaces. */
function checksumOf(header: Buffer): number {
  let total = 0;
  for (const [index, byte] of header.entries()) {
    total += index >= 148 && index < 156 ? 0x20 : byte;
  }
  return total;
}

/** The header of a regular file `name` of `size` bytes: mode 0644, owner 0, time 0. */
export function ustarHeader(name: string, size: number): Buffer {
  if (
    name.length > NAME_LIMIT ||
    Buffer.byteLength(name, 'utf8') !== name.length
  ) {
    throw new RangeError(`the tar name "${name}" is over 100 ASCII bytes`);
  }
  if (!Number.isInteger(size) || size < 0 || size > SIZE_LIMIT) {
    throw new RangeError(
      `the tar size ${String(size)} is not in 0 to 8 GiB - 1`,
    );
  }
  const header = Buffer.alloc(BLOCK);
  writeAscii(header, 0, name);
  writeAscii(header, 100, '0000644\0');
  writeAscii(header, 108, '0000000\0');
  writeAscii(header, 116, '0000000\0');
  writeAscii(header, 124, octal(size, 11));
  writeAscii(header, 136, octal(0, 11));
  writeAscii(header, 156, '0');
  writeAscii(header, 257, 'ustar\0');
  writeAscii(header, 263, '00');
  writeAscii(
    header,
    148,
    `${checksumOf(header).toString(8).padStart(6, '0')}\0 `,
  );
  return header;
}

/** The bytes after a file of `size` bytes: zeros up to a multiple of 512, then two zero blocks. */
export function ustarTrailer(size: number): Buffer {
  return Buffer.alloc(((BLOCK - (size % BLOCK)) % BLOCK) + 2 * BLOCK);
}
