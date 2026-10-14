import {deepStrictEqual} from 'node:assert';
import {isBelowMinimum, serverApiOf} from '../../src/engine/version-reply.ts';

const REACHABLE =
  '{"Client":{"Version":"29.9.0","ApiVersion":"1.56","Context":"default"},"Server":{"Version":"29.9.0","ApiVersion":"1.56","MinAPIVersion":"1.40"}}';

/** A reply with the given server API version and client API version. */
function reply(server: string, client = '1.56'): string {
  return JSON.stringify({
    Client: {ApiVersion: client},
    Server: {ApiVersion: server},
  });
}

describe('the version reply of the engine', () => {
  it('F-0201 BR-5: the measured reply of a reachable engine gives the server API version', () => {
    deepStrictEqual(serverApiOf(REACHABLE), '1.56');
  });

  for (const [apiVersion, below] of [
    ['1.34', true],
    ['1.35', false],
    ['1.4', true],
    ['1.100', false],
  ] as const) {
    it(`F-0201 BR-5: the server API ${apiVersion} ${below ? 'is' : 'is not'} below the minimum`, () => {
      deepStrictEqual(isBelowMinimum(serverApiOf(reply(apiVersion))), below);
    });
  }

  it('F-0201 AC-31: a client API of 1.30 does not matter when the server answers 1.51', () => {
    deepStrictEqual(isBelowMinimum(serverApiOf(reply('1.51', '1.30'))), false);
  });

  for (const [name, stdout] of [
    ['a null Server', '{"Client":{},"Server":null}'],
    ['no ApiVersion', '{"Server":{"Version":"1.0"}}'],
    ['an odd ApiVersion', reply('not-a-version-string')],
    ['text that is not JSON', 'not json'],
    [
      'a product version of 17.0.0 and no ApiVersion',
      '{"Server":{"Version":"17.0.0"}}',
    ],
  ] as const) {
    it(`F-0201 AC-8: ${name} gives no API version and passes the minimum`, () => {
      deepStrictEqual(isBelowMinimum(serverApiOf(stdout)), false);
    });
  }

  it('F-0201 AC-31: a product version of 17.0.0 with ApiVersion 1.51 passes', () => {
    deepStrictEqual(
      isBelowMinimum(
        serverApiOf('{"Server":{"Version":"17.0.0","ApiVersion":"1.51"}}'),
      ),
      false,
    );
  });
});
