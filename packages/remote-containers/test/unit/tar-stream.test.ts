import {deepStrictEqual, throws} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {ustarHeader, ustarTrailer} from '../../src/exec/tar-stream.ts';

describe('the tar stream of one file (card containers-02)', () => {
  it('contracts §1: a header, five bytes and a trailer are an archive tar lists with the name and size', () => {
    const archive = Buffer.concat([
      ustarHeader('a.tar.gz', 5),
      Buffer.from('hello'),
      ustarTrailer(5),
    ]);
    const listed = spawnSync('tar', ['-t', '-v', '-f', '-'], {input: archive});
    deepStrictEqual(
      [listed.status, /\s5 .*a\.tar\.gz/.test(listed.stdout.toString())],
      [0, true],
    );
  });

  it('contracts §1: the archive is 512, 512 and 1024 bytes long', () => {
    deepStrictEqual(
      Buffer.concat([ustarHeader('a', 5), Buffer.alloc(5), ustarTrailer(5)])
        .length,
      512 + 512 + 1024,
    );
  });

  it('contracts §1: the checksum field holds the sum of the header with the field read as spaces', () => {
    const header = ustarHeader('a.bin', 123);
    const spaced = Buffer.from(header);
    spaced.fill(0x20, 148, 156);
    const total = [...spaced].reduce((subtotal, byte) => subtotal + byte, 0);
    deepStrictEqual(
      header.subarray(148, 156).toString('ascii'),
      `${total.toString(8).padStart(6, '0')}\x00 `,
    );
  });

  it('contracts §1: the header says mode 0644, owner 0, a regular file, and ustar', () => {
    const header = ustarHeader('a.bin', 9);
    deepStrictEqual(
      [
        header.subarray(100, 108).toString('ascii'),
        header.subarray(108, 124).toString('ascii'),
        header.subarray(124, 136).toString('ascii'),
        header.subarray(156, 157).toString('ascii'),
        header.subarray(257, 265).toString('ascii'),
      ],
      [
        '0000644\x00',
        '0000000\x000000000\x00',
        '00000000011\x00',
        '0',
        'ustar\x00' + '00',
      ],
    );
  });

  it('contracts §1: a name over 100 bytes is refused, naming it', () => {
    throws(() => ustarHeader('n'.repeat(101), 1), RangeError);
  });

  it('contracts §1: a name that is not ASCII is refused', () => {
    throws(() => ustarHeader('é.tar', 1), RangeError);
  });

  it('contracts §1: a size of 8 GiB is refused, and a size that is not a whole number', () => {
    deepStrictEqual(
      [2 ** 33, -1, 1.5].map(size => {
        try {
          ustarHeader('a', size);
          return 'accepted';
        } catch (caught) {
          return caught instanceof RangeError ? 'refused' : 'other';
        }
      }),
      ['refused', 'refused', 'refused'],
    );
  });

  it('contracts §1: the largest size, 8 GiB minus 1, is accepted', () => {
    deepStrictEqual(
      ustarHeader('a', 8 ** 11 - 1)
        .subarray(124, 136)
        .toString('ascii'),
      '77777777777\x00',
    );
  });

  it('contracts §1: the trailer pads to a multiple of 512 and adds two blocks', () => {
    deepStrictEqual(
      [0, 512, 513].map(size => ustarTrailer(size).length),
      [1024, 1024, 1535],
    );
  });
});
