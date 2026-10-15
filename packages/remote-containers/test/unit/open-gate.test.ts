import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {openPathAllowed} from '../../src/open/open-gate.ts';

/** What the gate saw of one call: the answer, the calls to the setup, and the log. */
async function gated(
  missing: string[],
  missingAfter: string[] = missing,
  hangingInteraction = false,
  failure?: unknown,
): Promise<{allowed: boolean; probes: number; lines: string[]}> {
  const sink = new MemorySink();
  let probes = 0;
  const allowed = await openPathAllowed(
    {
      missing,
      setupAgain: () => {
        probes += 1;
        if (failure !== undefined) {
          // The rows on a rejection that is not an error need exactly that.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject(failure);
        }
        return Promise.resolve({
          decision: {missing: missingAfter},
          interaction: hangingInteraction
            ? new Promise(() => undefined)
            : undefined,
        });
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    'Reopen in Container',
  );
  return {
    allowed,
    probes,
    lines: sink.lines.map(line => `${line.level}: ${line.message}`),
  };
}

describe('openPathAllowed', () => {
  it('F-0101 BR-9: a missing resolvers probes again once and holds back the open path', async () => {
    deepStrictEqual(await gated(['resolvers']), {
      allowed: false,
      probes: 1,
      lines: [
        'info: Reopen in Container needs the proposed API: resolvers; the window stays as it is',
      ],
    });
  });

  it('F-0101 BR-9: a missing workspaceTrust probes again once and holds back the open path', async () => {
    deepStrictEqual(await gated(['workspaceTrust', 'tunnels']), {
      allowed: false,
      probes: 1,
      lines: [
        'info: Reopen in Container needs the proposed API: workspaceTrust; the window stays as it is',
      ],
    });
  });

  it('F-0101 BR-9: nothing missing, or only contribViewsRemote, goes on with no probe', async () => {
    deepStrictEqual(
      [await gated([]), await gated(['contribViewsRemote'])],
      [
        {allowed: true, probes: 0, lines: []},
        {allowed: true, probes: 0, lines: []},
      ],
    );
  });

  it('F-0101 BR-9: a proposal the new probe finds granted goes on', async () => {
    deepStrictEqual(await gated(['resolvers'], []), {
      allowed: true,
      probes: 1,
      lines: [],
    });
  });

  it('F-0101 BR-9: a notice nobody answers does not hold the guard', async () => {
    deepStrictEqual(
      (await gated(['resolvers'], ['resolvers'], true)).allowed,
      false,
    );
  });

  it('F-0101 BR-9: a probe that fails holds the command back and is logged, an error or not', async () => {
    deepStrictEqual(
      [
        await gated(['resolvers'], [], false, new Error('no probe')),
        await gated(['resolvers'], [], false, 'gone'),
      ].map(({allowed, probes, lines}) => [allowed, probes, lines]),
      [
        [
          false,
          1,
          [
            'warn: Reopen in Container could not probe the proposed API again: no probe; the window stays as it is',
          ],
        ],
        [
          false,
          1,
          [
            'warn: Reopen in Container could not probe the proposed API again: gone; the window stays as it is',
          ],
        ],
      ],
    );
  });
});
