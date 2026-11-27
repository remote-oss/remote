import {deepStrictEqual} from 'node:assert';
import * as state from '../../src/index.ts';

describe('lib-state', () => {
  it('gives the event files, the handoffs and the file port of this machine', () => {
    deepStrictEqual(
      [
        typeof state.eventStoreOf,
        typeof state.handoffStoreOf,
        typeof state.newSession,
        typeof state.isRecord,
        typeof state.NODE_EVENT_FILES.names,
      ],
      ['function', 'function', 'function', 'function', 'function'],
    );
  });
});
