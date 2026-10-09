/**
 * @fileoverview The progress-line parser: the ruled progress line of the bootstrap script's output, and the
 * parser that reads it back.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {parseProgressLine, progressLines} from '../../src/index.ts';

describe('progress-line parser (card server-08 table)', () => {
  it("'remote-oss-server-progress unpack 40' -> {step: 'unpack', percent: 40}", () => {
    deepStrictEqual(parseProgressLine('remote-oss-server-progress unpack 40'), {
      step: 'unpack',
      percent: 40,
    });
  });

  it("'remote-oss-server-progress download 100' -> {step: 'download', percent: 100}", () => {
    deepStrictEqual(
      parseProgressLine('remote-oss-server-progress download 100'),
      {step: 'download', percent: 100},
    );
  });

  it("'remote-oss-server-progress unpack 0' -> {step: 'unpack', percent: 0}", () => {
    deepStrictEqual(parseProgressLine('remote-oss-server-progress unpack 0'), {
      step: 'unpack',
      percent: 0,
    });
  });

  it("'remote-oss-server-progress unpack 40\\r' -> {step: 'unpack', percent: 40}", () => {
    deepStrictEqual(
      parseProgressLine('remote-oss-server-progress unpack 40\r'),
      {step: 'unpack', percent: 40},
    );
  });

  it("'remote-oss-server-progress unpack 101' -> undefined", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress unpack 101'),
      undefined,
    );
  });

  it("'remote-oss-server-progress unpack -1' -> undefined", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress unpack -1'),
      undefined,
    );
  });

  it("'remote-oss-server-progress unpack +5' -> undefined", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress unpack +5'),
      undefined,
    );
  });

  it("'remote-oss-server-progress unpack 4.5' -> undefined", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress unpack 4.5'),
      undefined,
    );
  });

  it("'remote-oss-server-progress unpack 05' -> undefined (a leading zero is refused)", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress unpack 05'),
      undefined,
    );
  });

  it("'remote-oss-server-progress install 10' -> undefined (an unknown step)", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress install 10'),
      undefined,
    );
  });

  it("'remote-oss-server-progress  unpack 40' (two spaces) -> undefined", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress  unpack 40'),
      undefined,
    );
  });

  it("' remote-oss-server-progress unpack 40' (a leading space) -> undefined", () => {
    strictEqual(
      parseProgressLine(' remote-oss-server-progress unpack 40'),
      undefined,
    );
  });

  it("'remote-oss-server-progress unpack 40 extra' -> undefined", () => {
    strictEqual(
      parseProgressLine('remote-oss-server-progress unpack 40 extra'),
      undefined,
    );
  });

  it("'status=Ok' -> undefined", () => {
    strictEqual(parseProgressLine('status=Ok'), undefined);
  });

  it("progressLines(['a', unpack 5, 'b', unpack 10]) -> [{unpack, 5}, {unpack, 10}]", () => {
    deepStrictEqual(
      progressLines([
        'a',
        'remote-oss-server-progress unpack 5',
        'b',
        'remote-oss-server-progress unpack 10',
      ]),
      [
        {step: 'unpack', percent: 5},
        {step: 'unpack', percent: 10},
      ],
    );
  });

  it('progressLines([]) -> []', () => {
    deepStrictEqual(progressLines([]), []);
  });
});
