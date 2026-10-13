import {strictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  onHost,
  openWindow,
  waitUntil,
  windowEvents,
} from '../suite/harness.ts';

describe('windows opened from a local window (this window is local)', () => {
  it('D-85: with the second window closed, the third is still connected', async () => {
    await openWindow('harness', 'b');
    await openWindow('harness', 'c');
    await closeWindow('b');
    const id = await inWindow(
      'c',
      'acceptance.agent.writeFile',
      'still-here.txt',
      'c',
    );
    await waitUntil('window c to finish writing', () =>
      windowEvents('c').some(each => each.id === id && each.event === 'done'),
    );
    strictEqual(await onHost('cat', '/home/harness/c/still-here.txt'), 'c');
  });
});
