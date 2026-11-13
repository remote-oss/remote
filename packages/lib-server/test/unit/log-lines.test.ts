import {deepStrictEqual} from 'node:assert';
import {
  masked,
  maskOf,
  type ResultBlock,
  serverResultLine,
} from '../../src/index.ts';

describe('the token and the server result in the log (card connect-65, connect-67)', () => {
  it('F-2003 7.E6: the token is masked in every occurrence, as text, and an empty or absent token changes nothing', () => {
    deepStrictEqual(
      [
        masked('ab12-cd34 and ab12-cd34', 'ab12-cd34'),
        masked('x ab$&cd y', 'ab$&cd'),
        masked('keep ab12-cd34', ''),
        masked('keep ab12-cd34', undefined),
        maskOf('ab12-cd34'),
      ],
      [
        'aa11-aa11 and aa11-aa11',
        'x aa$&aa y',
        'keep ab12-cd34',
        'keep ab12-cd34',
        'aa11-aa11',
      ],
    );
  });
});

describe('the lines of the client search and the probed platform (card connect-28)', () => {
  /** A parsed block with `facts`, as lib-server gives it. */
  function parsedBlock(
    facts: Partial<Pick<ResultBlock, 'hostFacts' | 'serverFacts' | 'timings'>>,
  ): ResultBlock {
    return {
      status: 'Ok',
      hostFacts: {},
      serverFacts: {},
      cliFacts: {},
      timings: {},
      ...facts,
    };
  }

  it('F-2003 BR-6 item 8: the result is logged as one summary line from the parsed block', () => {
    deepStrictEqual(
      serverResultLine(
        parsedBlock({
          hostFacts: {os: 'linux', arch: 'x64', display: ':10'},
          serverFacts: {port: '41234', token: 'secret'},
          timings: {download: 1200, install: 800, start: 90},
        }),
      ),
      'Server result: Ok, port 41234, os linux, architecture x64, download 1200 ms, install 800 ms',
    );
  });

  it('F-2003 BR-14: the summary has only the parts the block has, and no other fact', () => {
    deepStrictEqual(
      serverResultLine(parsedBlock({hostFacts: {sshAuthSock: '/tmp/a'}})),
      'Server result: Ok',
    );
  });
});
