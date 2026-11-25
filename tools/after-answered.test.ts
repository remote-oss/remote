import {deepStrictEqual, rejects} from 'node:assert';
import {
  afterAnswered,
  type AfterAnsweredPorts,
  type DialogIdentity,
} from '../tests/acceptance/containers-trust/after-answered.ts';

const ANSWERED = 'Do you trust the authors?';

/** Ports over a script of what the page shows at each look: a message, or nothing; a clock that each look advances. */
function portsOf(
  script: ReadonlyArray<string | undefined>,
  identities: readonly DialogIdentity[] = [],
  bound = 1000,
): AfterAnsweredPorts<string> & {marked: number} {
  let looks = 0;
  let reads = 0;
  const ports = {
    marked: 0,
    look: () => {
      const shown = script[Math.min(looks, script.length - 1)];
      looks += 1;
      return shown === undefined
        ? Promise.reject(new Error('none'))
        : Promise.resolve(shown);
    },
    messageOf: (found: string) => found,
    mark: () => {
      ports.marked += 1;
      return Promise.resolve();
    },
    identity: () => {
      const identity = identities[Math.min(reads, identities.length - 1)];
      reads += 1;
      return Promise.resolve(identity ?? 'answered');
    },
    now: () => looks * 100,
    bound,
  };
  return ports;
}

describe('the wait for the dialog after an answered one (card #3193)', () => {
  it('#3193: a different message after the answered one is the next dialog, and the dialog was marked once before the wait', async () => {
    const ports = portsOf([ANSWERED, 'Server settings']);
    deepStrictEqual(
      [await afterAnswered('win', ANSWERED, ports), ports.marked],
      ['Server settings', 1],
    );
  });

  it('#3193: the question shown again by a new dialog is core asking a second time, with no gap needed', async () => {
    await rejects(
      afterAnswered(
        'win',
        ANSWERED,
        portsOf([ANSWERED], ['answered', 'another']),
      ),
      /is shown by a new dialog, not the one that was answered/u,
    );
  });

  it('#3193: the question again after a moment with no dialog is a second ask too', async () => {
    await rejects(
      afterAnswered(
        'win',
        ANSWERED,
        portsOf([undefined, ANSWERED], ['answered']),
      ),
      /was on the page again after the page held no dialog/u,
    );
  });

  it('#3193: the answered dialog still up at the bound says the press did not close it', async () => {
    await rejects(
      afterAnswered('win', ANSWERED, portsOf([ANSWERED], ['answered'])),
      /stale dialog never closed.*the press did not close it/u,
    );
  });

  it('#3193: a page with no dialog until the bound is no next dialog', async () => {
    await rejects(
      afterAnswered('win', ANSWERED, portsOf([undefined])),
      /no next dialog/u,
    );
  });

  it('#3193: a wait with no identity reads a stale dialog without the claim about the press', async () => {
    const ports = portsOf([ANSWERED]);
    delete ports.identity;
    await rejects(
      afterAnswered('win', ANSWERED, ports),
      (caught: Error) =>
        caught.message.includes('stale dialog never closed') &&
        !caught.message.includes('the press'),
    );
  });
});
