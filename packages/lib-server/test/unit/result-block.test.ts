import {deepStrictEqual, fail} from 'node:assert';
import {readFileSync} from 'node:fs';
import {NOISE_LINES} from 'lib-host/testing/noise';
import {
  parseResult,
  type ResultBlock,
  RESULT_BEGIN,
  RESULT_END,
} from '../../src/index.ts';

// The constructed output lines of a fixture, one .txt per table row.
function fixtureLines(name: string): string[] {
  const text = readFileSync(
    new URL(`../fixtures/result-block/${name}.txt`, import.meta.url),
    'utf8',
  );
  return text.split('\n');
}

// The block of a fixture, asserting the fixture holds a complete result block.
function blockOf(name: string): ResultBlock {
  const result = parseResult(fixtureLines(name));
  if ('failure' in result) {
    fail(`expected a result block from ${name}, got ${result.failure}`);
  }
  return result.block;
}

const EMPTY_BLOCK = {hostFacts: {}, serverFacts: {}, cliFacts: {}, timings: {}};

describe('parseResult (card server-02 table)', () => {
  it('[] -> noResultBlock', () => {
    deepStrictEqual(parseResult([]), {failure: 'noResultBlock'});
  });

  it("['noise'] -> noResultBlock", () => {
    deepStrictEqual(parseResult(['noise']), {failure: 'noResultBlock'});
  });

  it('begin, status=Ok, end -> status Ok, empty facts and timings', () => {
    deepStrictEqual(parseResult(fixtureLines('basic')), {
      block: {status: 'Ok', ...EMPTY_BLOCK},
    });
  });

  it('begin, status=Ok, host.os=linux, host.arch=x64, server.port=41263, timing.download=1532, end -> hostFacts {os, arch}, serverFacts {port}, timings {download}', () => {
    deepStrictEqual(parseResult(fixtureLines('with-facts')), {
      block: {
        status: 'Ok',
        hostFacts: {os: 'linux', arch: 'x64'},
        serverFacts: {port: '41263'},
        cliFacts: {},
        timings: {download: 1532},
      },
    });
  });

  it('cli.path and cli.port lines -> cliFacts {path, port}', () => {
    deepStrictEqual(
      parseResult([
        RESULT_BEGIN,
        'status=Ok',
        'cli.path=/h/codium',
        'cli.port=41234',
        RESULT_END,
      ]),
      {
        block: {
          status: 'Ok',
          ...EMPTY_BLOCK,
          cliFacts: {path: '/h/codium', port: '41234'},
        },
      },
    );
  });

  it('begin without end -> noResultBlock', () => {
    deepStrictEqual(parseResult(fixtureLines('without-end')), {
      failure: 'noResultBlock',
    });
  });

  it('two complete blocks (status=LockBusy then status=Ok) -> status Ok (the last wins)', () => {
    deepStrictEqual(parseResult(fixtureLines('two-blocks')), {
      block: {status: 'Ok', ...EMPTY_BLOCK},
    });
  });

  it('a complete block then an incomplete one -> the complete block values', () => {
    deepStrictEqual(parseResult(fixtureLines('complete-then-incomplete')), {
      block: {status: 'Ok', ...EMPTY_BLOCK},
    });
  });

  it('begin, status=Ok, garbage line, end -> parsed; the garbage ignored', () => {
    deepStrictEqual(parseResult(fixtureLines('garbage')), {
      block: {status: 'Ok', ...EMPTY_BLOCK},
    });
  });

  it('begin, host.os=linux, end (no status) -> noResultBlock', () => {
    deepStrictEqual(parseResult(fixtureLines('no-status')), {
      failure: 'noResultBlock',
    });
  });

  it('status=Weird -> status ServerFailedToStart, unknownStatus Weird', () => {
    deepStrictEqual(parseResult(fixtureLines('unknown-status')), {
      block: {
        status: 'ServerFailedToStart',
        ...EMPTY_BLOCK,
        unknownStatus: 'Weird',
      },
    });
  });

  for (const word of [
    'Ok',
    'LockBusy',
    'NoDownloaderAvailable',
    'UnpackFailed',
    'ServerDownloadFailed',
    'CreateInstallDirFailed',
    'UnsupportedArch',
    'UnsupportedPlatform',
    'LinuxPrereqs',
    'NoBash',
    'ServerFailedToStart',
  ]) {
    it(`each of the eleven status words: status=${word} -> the matching status, unknownStatus undefined`, () => {
      deepStrictEqual(
        parseResult([RESULT_BEGIN, `status=${word}`, RESULT_END]),
        {block: {status: word, ...EMPTY_BLOCK}},
      );
    });
  }

  it('timing.unpack=abc and timing.start=-5 -> both dropped', () => {
    deepStrictEqual(blockOf('bad-timings').timings, {});
  });

  it('timing.unpack=07 -> timings {unpack: 7}', () => {
    deepStrictEqual(blockOf('octal-timing').timings, {unpack: 7});
  });

  it('host.os=linux, then host.os=alpine -> hostFacts {os: alpine}', () => {
    deepStrictEqual(blockOf('duplicate-host').hostFacts, {os: 'alpine'});
  });

  it('server.path=/a/b=c -> serverFacts {path: /a/b=c} (split on the first = only)', () => {
    deepStrictEqual(blockOf('value-equals').serverFacts, {path: '/a/b=c'});
  });

  it('lines ending in \\r -> identical result to the same lines without \\r', () => {
    deepStrictEqual(parseResult(fixtureLines('carriage-return')), {
      block: {status: 'Ok', ...EMPTY_BLOCK},
    });
  });

  it('a marker line with trailing spaces -> not a marker (whole-line match), so noResultBlock', () => {
    deepStrictEqual(parseResult(fixtureLines('marker-spaces')), {
      failure: 'noResultBlock',
    });
  });

  it('status=Ok with leading spaces -> ignored (keys are not trimmed), so the block has no status and it is noResultBlock', () => {
    deepStrictEqual(parseResult(fixtureLines('key-spaces')), {
      failure: 'noResultBlock',
    });
  });

  it('ADR-0010: the result block: noise with a status, then an end marker, is no result block', () => {
    deepStrictEqual(parseResult([...NOISE_LINES, RESULT_END]), {
      failure: 'noResultBlock',
    });
  });

  it('ADR-0010: the result block: noise around and inside its stream changes nothing', () => {
    deepStrictEqual(
      parseResult([
        ...NOISE_LINES,
        ...fixtureLines('with-facts'),
        ...NOISE_LINES,
        RESULT_BEGIN,
        'status=Ok',
        'host.arch=arm64',
        ...NOISE_LINES,
      ]),
      parseResult(fixtureLines('with-facts')),
    );
  });
});
