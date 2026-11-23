import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  ensureTrusted,
  TRUST_TEMPLATES,
  type TrustOutcome,
} from '../../src/trust/trust-gate.ts';

/** How the port answers a request, and how the setup ends. */
interface Setup {
  trusted: boolean;
  request: 'trust' | 'decline' | 'reject';
  /** What a rejected request and a rejected setup throw. */
  requestFailure: unknown;
  setup: 'works' | 'rejects';
  setupFailure: unknown;
}

/** What a check gave, and what the fakes recorded of it. */
interface Outcome {
  result: TrustOutcome;
  calls: string[];
  lines: string[];
}

async function checked(state: Partial<Setup>): Promise<Outcome> {
  const {
    trusted = false,
    request = 'trust',
    requestFailure = new Error('proposal'),
    setup = 'works',
    setupFailure = new Error('no argv'),
  } = state;
  const calls: string[] = [];
  const sink = new MemorySink();
  const result = await ensureTrusted(
    {
      isTrusted: () => trusted,
      request: message => {
        calls.push(`request ${message}`);
        if (request === 'reject') {
          // The row on a rejection that is not an error needs exactly that.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject(requestFailure);
        }
        return Promise.resolve(request === 'trust');
      },
    },
    {
      translate: template => `«${template}»`,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
      setupAgain: () => {
        calls.push('setupAgain');
        if (setup === 'works') {
          return Promise.resolve();
        }
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(setupFailure);
      },
      commandTitle: 'Reopen in Container',
    },
  );
  return {
    result,
    calls,
    lines: sink.lines.map(line => `${line.level}: ${line.message}`),
  };
}

describe('ensureTrusted', () => {
  it('F-0106 AC-5: a trusted folder goes on at once, with no request and no line (6.2, BR-10)', async () => {
    deepStrictEqual(await checked({trusted: true}), {
      result: 'trusted',
      calls: [],
      lines: [],
    });
  });

  it('F-0106 BR-2, STR:S265: an untrusted folder is asked once, with S265 translated as the body, and goes on when trusted', async () => {
    deepStrictEqual(await checked({request: 'trust'}), {
      result: 'trusted',
      calls: [`request «${TRUST_TEMPLATES.S265}»`],
      lines: ['info: the folder is trusted now; Reopen in Container goes on'],
    });
  });

  it('F-0106 6.4, AC-7: a declined request does nothing and names the command in the log', async () => {
    deepStrictEqual(await checked({request: 'decline'}), {
      result: 'declined',
      calls: [`request «${TRUST_TEMPLATES.S265}»`],
      lines: [
        "info: the folder isn't trusted; Reopen in Container does nothing",
      ],
    });
  });

  it('brief ruling 9: a refused proposal answers with the setup notice, after the request', async () => {
    deepStrictEqual(await checked({request: 'reject'}), {
      result: 'unavailable',
      calls: [`request «${TRUST_TEMPLATES.S265}»`, 'setupAgain'],
      lines: ['warn: the trust request failed: proposal'],
    });
  });

  it('brief ruling 9: a setup that fails is logged, and the check still ends unavailable', async () => {
    deepStrictEqual(await checked({request: 'reject', setup: 'rejects'}), {
      result: 'unavailable',
      calls: [`request «${TRUST_TEMPLATES.S265}»`, 'setupAgain'],
      lines: [
        'warn: the trust request failed: proposal',
        'warn: the proposed-API setup failed: no argv',
      ],
    });
  });

  it('brief ruling 9: a rejection that is not an error is logged as text', async () => {
    deepStrictEqual(
      await checked({
        request: 'reject',
        requestFailure: 'refused',
        setup: 'rejects',
        setupFailure: 'gone',
      }),
      {
        result: 'unavailable',
        calls: [`request «${TRUST_TEMPLATES.S265}»`, 'setupAgain'],
        lines: [
          'warn: the trust request failed: refused',
          'warn: the proposed-API setup failed: gone',
        ],
      },
    );
  });

  it('F-0106 BR-6, STR:S124 to STR:S130: none of the unshown strings reaches the request, the setup notice or the log, whichever way the check ends', async () => {
    const unshown = [
      TRUST_TEMPLATES.S124,
      TRUST_TEMPLATES.S125,
      TRUST_TEMPLATES.S126,
      TRUST_TEMPLATES.S127,
      TRUST_TEMPLATES.S128,
      TRUST_TEMPLATES.S129,
      TRUST_TEMPLATES.S130,
    ];
    const shown: string[] = [];
    for (const state of [
      {trusted: true},
      {request: 'trust'},
      {request: 'decline'},
      {request: 'reject', setup: 'rejects'},
    ] as const) {
      const outcome = await checked(state);
      shown.push(...outcome.calls, ...outcome.lines);
    }
    deepStrictEqual(
      shown.filter(text => unshown.some(each => text.includes(each))),
      [],
    );
  });
});
