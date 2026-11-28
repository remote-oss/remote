import {deepStrictEqual} from 'node:assert';
import {lazyChannel} from '../../src/output-channel.ts';

/** A channel that records the lines written to it, and how many were made. */
function recording() {
  const made: string[][] = [];
  return {
    made,
    create: () => {
      const lines: string[] = [];
      made.push(lines);
      return {
        info: (line: string) => {
          lines.push(line);
        },
      };
    },
  };
}

describe('the Output channel of Remote - Tunnels (card #3339)', () => {
  it('F-8001 AC-6: is not created before it is asked for, and once asked is created once whatever the number of calls', () => {
    const channel = recording();
    const open = lazyChannel(channel.create, true, 'unavailable');
    const before = channel.made.length;
    const first = open();
    const second = open();
    deepStrictEqual(
      [before, channel.made.length, first === second],
      [0, 1, true],
    );
  });

  it('F-8001 AC-26: holds the line that the resolver is unavailable as the first line of a channel made without the resolvers, and no other line', () => {
    const channel = recording();
    const open = lazyChannel(channel.create, false, 'unavailable');
    open();
    open();
    deepStrictEqual(channel.made, [['unavailable']]);
  });

  it('F-8001 AC-26: writes nothing to a channel made with the resolvers', () => {
    const channel = recording();
    lazyChannel(channel.create, true, 'unavailable')();
    deepStrictEqual(channel.made, [[]]);
  });
});
