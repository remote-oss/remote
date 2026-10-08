import {deepStrictEqual, strictEqual} from 'node:assert';
import {redact, secret} from '../../src/index.ts';

describe('redaction (card log-01 table)', () => {
  it('redact(token abcdefghijklmnopqrstuvwxyz012345 ok, []) (32 chars) -> [redacted]', () => {
    strictEqual(
      redact('token abcdefghijklmnopqrstuvwxyz012345 ok', []),
      '[redacted]',
    );
  });

  it('redact(token abc ok, [abc]) -> token [redacted] ok', () => {
    strictEqual(redact('token abc ok', ['abc']), 'token [redacted] ok');
  });

  it('redact(two abc and abc, [abc]) -> two [redacted] and [redacted]', () => {
    strictEqual(
      redact('two abc and abc', ['abc']),
      'two [redacted] and [redacted]',
    );
  });

  it('redact(plain text, []) -> plain text', () => {
    strictEqual(redact('plain text', []), 'plain text');
  });

  it('redact(x, [""]) -> x (empty secrets are ignored)', () => {
    strictEqual(redact('x', ['']), 'x');
  });

  it('`${secret(p4ss)}` -> [secret]', () => {
    strictEqual(String(secret('p4ss')), '[secret]');
  });

  it('String(secret(p4ss)).includes(p4ss) -> false', () => {
    deepStrictEqual(String(secret('p4ss')).includes('p4ss'), false);
  });
});
