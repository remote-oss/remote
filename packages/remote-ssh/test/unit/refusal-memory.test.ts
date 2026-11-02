import {deepStrictEqual} from 'node:assert';
import {
  REFUSAL_MEMORY_KEY,
  refusalMemoryOf,
} from '../../src/diagnostics/refusal-memory.ts';

/** A memory over an in-memory state, with the writes it saw. */
function remembering(refuse = false) {
  const stored: {value?: readonly string[]} = {};
  const writes: Array<readonly string[]> = [];
  const memory = refusalMemoryOf({
    get: () => stored.value,
    update: (key, value) => {
      writes.push([key, ...value]);
      if (refuse) {
        return Promise.reject(new Error('refused'));
      }
      stored.value = value;
      return Promise.resolve();
    },
  });
  return {memory, stored, writes};
}

describe('what is remembered of the logged refusals (card connect-124)', () => {
  it('F-2604 AC-15: a connection that was added is found, and another is not', () => {
    const {memory} = remembering();
    memory.remember('devbox:1080');
    deepStrictEqual(
      [memory.contains('devbox:1080'), memory.contains('devbox:1081')],
      [true, false],
    );
  });

  it('F-2604 AC-15: a connection is written once, under the key, and the oldest of twenty-one is forgotten', () => {
    const {memory, stored, writes} = remembering();
    for (let port = 1; port <= 21; port += 1) {
      memory.remember(`devbox:${String(port)}`);
    }
    memory.remember('devbox:21');
    deepStrictEqual(
      [
        writes[0],
        stored.value?.length,
        stored.value?.includes('devbox:1'),
        stored.value?.at(-1),
      ],
      [[REFUSAL_MEMORY_KEY, 'devbox:1'], 20, false, 'devbox:21'],
    );
  });

  it('F-2604 AC-15: a write the state refuses is no failure of the connect', async () => {
    const {memory} = remembering(true);
    memory.remember('devbox:1080');
    await new Promise(resolve => setTimeout(resolve, 0));
    deepStrictEqual(memory.contains('devbox:1080'), false);
  });
});
