import {deepStrictEqual} from 'node:assert';
import {
  type ContainerState,
  reconnectionOutcomeOf,
} from '../../src/connect/reconnection.ts';

const HELD = {startedAt: '2026-10-14T08:00:00Z'};

function outcome(state: ContainerState, serverAlive?: boolean): string {
  return reconnectionOutcomeOf(HELD, state, serverAlive);
}

describe('the answer of a reconnection (card containers-08)', () => {
  it('F-0502 BR-8, 7.E3: a container that is gone, or neither running nor paused, is gone for good', () => {
    deepStrictEqual(
      [
        outcome('missing'),
        outcome({status: 'exited', startedAt: HELD.startedAt}),
        outcome({status: 'created', startedAt: HELD.startedAt}),
      ],
      ['containerGone', 'containerGone', 'containerGone'],
    );
  });

  it('F-0502 7.E16: a running container with another start is gone for good', () => {
    deepStrictEqual(
      outcome({status: 'running', startedAt: '2026-10-14T09:00:00Z'}, true),
      'containerGone',
    );
  });

  it('F-0502 7.E15: a paused container may come back', () => {
    deepStrictEqual(
      outcome({status: 'paused', startedAt: HELD.startedAt}),
      'transportLost',
    );
  });

  it('F-0502 7.E15: a running container of the same start with its server alive is held', () => {
    deepStrictEqual(
      outcome({status: 'running', startedAt: HELD.startedAt}, true),
      'held',
    );
  });

  it('F-0502 7.E1: a running container of the same start whose server is gone, or was not asked, may come back', () => {
    deepStrictEqual(
      [
        outcome({status: 'running', startedAt: HELD.startedAt}, false),
        outcome({status: 'running', startedAt: HELD.startedAt}),
      ],
      ['transportLost', 'transportLost'],
    );
  });
});
