import {strictEqual} from 'node:assert';
import {redact} from '../../src/index.ts';

/** The card's 40-hex commit id and 64-hex digest. */
const COMMIT_ID = '0123456789abcdef0123456789abcdef01234567';
const DIGEST =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('redaction (card log-03 table)', () => {
  it('redact of a 32-char run -> the marker, the rest of the message stays', () => {
    strictEqual(
      redact('token abcdefghijklmnopqrstuvwxyz012345 ok', []),
      'token [redacted] ok',
    );
  });

  it('redact of a 40-hex commit id -> unchanged', () => {
    strictEqual(
      redact(`commit ${COMMIT_ID} installed`, []),
      `commit ${COMMIT_ID} installed`,
    );
  });

  it('redact of a 64-hex digest -> unchanged', () => {
    strictEqual(redact(`sha ${DIGEST}`, []), `sha ${DIGEST}`);
  });

  it('redact of a 40-char run that is not hex -> the marker', () => {
    strictEqual(redact(`x ${'g'.repeat(40)} y`, []), 'x [redacted] y');
  });

  it('redact of a 64-char run that is not hex -> the marker', () => {
    strictEqual(redact(`x ${'g'.repeat(64)} y`, []), 'x [redacted] y');
  });

  it('redact of a 39-char hex run -> the marker', () => {
    strictEqual(redact(`x ${COMMIT_ID.slice(0, 39)} y`, []), 'x [redacted] y');
  });

  it('redact of a 41-char hex run -> the marker', () => {
    strictEqual(redact(`x ${COMMIT_ID}1 y`, []), 'x [redacted] y');
  });

  it('redact of a 40-hex run glued to word characters -> the marker, one run of 42', () => {
    strictEqual(redact(`${COMMIT_ID}_x`, []), '[redacted]');
  });

  it('redact of two runs in one message -> both marked, the text between kept', () => {
    strictEqual(
      redact(`a ${'a'.repeat(32)} b ${'b'.repeat(32)} c`, []),
      'a [redacted] b [redacted] c',
    );
  });

  it('redact with a named secret and a 40-hex id -> the secret marked, the id kept', () => {
    strictEqual(
      redact(`pw hunter2 and ${COMMIT_ID}`, ['hunter2']),
      `pw [redacted] and ${COMMIT_ID}`,
    );
  });

  it('redact of a message without a run -> unchanged', () => {
    strictEqual(redact('plain text', []), 'plain text');
  });

  it('redact of a message that already carries the marker -> unchanged, not doubled', () => {
    strictEqual(
      redact(`already [redacted] ${'a'.repeat(32)}`, []),
      'already [redacted] [redacted]',
    );
  });
});

describe('redaction (card log-01 table, the secret rows)', () => {
  it('redact(token abc ok, [abc]) -> token [redacted] ok', () => {
    strictEqual(redact('token abc ok', ['abc']), 'token [redacted] ok');
  });

  it('redact(two abc and abc, [abc]) -> two [redacted] and [redacted]', () => {
    strictEqual(
      redact('two abc and abc', ['abc']),
      'two [redacted] and [redacted]',
    );
  });

  it('redact(x, [""]) -> x (empty secrets are ignored)', () => {
    strictEqual(redact('x', ['']), 'x');
  });
});

describe('redaction (card log-03 rows, the id carve-out)', () => {
  it('log-03: server-<commit>-<epoch> stays readable', () => {
    strictEqual(
      redact(`server-${COMMIT_ID}-1728000000000`, []),
      `server-${COMMIT_ID}-1728000000000`,
    );
  });

  it('log-03: a 40-hex id and a 32-letter run across a hyphen -> the id kept, the run marked', () => {
    strictEqual(
      redact(`${COMMIT_ID}-${'a'.repeat(32)}`, []),
      `${COMMIT_ID}-[redacted]`,
    );
  });

  it('log-03: a UUID (36 characters with its hyphens) is redacted as one run', () => {
    strictEqual(
      redact('lease 123e4567-e89b-12d3-a456-426614174000 ended', []),
      'lease [redacted] ended',
    );
  });

  it('log-03: a 64-hex digest and a 40-hex id across a hyphen -> unchanged', () => {
    strictEqual(redact(`${DIGEST}-${COMMIT_ID}`, []), `${DIGEST}-${COMMIT_ID}`);
  });
});

describe('redaction (the outer-hyphen trim of a run)', () => {
  it('a run of 32 letters between two hyphens -> the hyphens kept, the letters marked', () => {
    strictEqual(redact(`-${'a'.repeat(32)}-`, []), '-[redacted]-');
  });
});

describe('redaction (a candidate whose trimmed run is short)', () => {
  it('a 32-character candidate that trims below 32 stays untouched', () => {
    strictEqual(redact(`-${'a'.repeat(30)}-`, []), `-${'a'.repeat(30)}-`);
  });
});
