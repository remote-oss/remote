/**
 * @fileoverview F-2310's host-key questions of the jump hosts through real quick picks (card #2686): each fingerprint
 * pick is answered by Enter while it holds the keyboard focus,.
 * The pickers of `ssh-newclient` are scripted and answered at once, so only this launch can show either.
 */

import {deepStrictEqual} from 'node:assert';
import {hostPort, waitFor} from '../windows/harness.ts';
import {
  connectWith,
  freshKnown,
  harnessHostFingerprint,
  startHostSshd,
} from '../windows/config-keywords-support.ts';
import {
  FIRST_PORT,
  knownHosts,
  oneJump,
  pickOf,
  SECOND_PORT,
  twoJumps,
} from '../windows/jump-pick-support.ts';
import {
  pressEnter,
  quickPickHasFocus,
  quickPickOf,
  quickPickRows,
  quickPickTitle,
} from '../windows/renderer.ts';

/** What a fingerprint pick showed when it was answered. */
interface AnsweredPick {
  title: string;
  items: string[];
  focused: string[];
  holdsFocus: boolean;
}

/** How long a question has to appear. */
const QUESTION_MILLISECONDS = 120_000;

/** Waits for `count` fingerprint picks of window `name`, one after the other, and answers each with Enter as it holds focus. */
async function answeredByEnter(
  name: string,
  count: number,
): Promise<AnsweredPick[]> {
  const answered: AnsweredPick[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = answered[index - 1]?.title;
    await waitFor(
      `fingerprint pick ${String(index + 1)} of ${name}`,
      async () => {
        const shown = await quickPickOf(name);
        return (
          shown !== undefined &&
          (await quickPickTitle(name)).includes('fingerprint') &&
          (await quickPickTitle(name)) !== before
        );
      },
      QUESTION_MILLISECONDS,
    );
    answered.push({
      title: await quickPickTitle(name),
      items: (await quickPickRows(name)).map(entry => entry.label),
      focused: (await quickPickRows(name))
        .filter(entry => entry.focused)
        .map(entry => entry.label),
      holdsFocus: await quickPickHasFocus(name),
    });
    await pressEnter(name);
  }
  return answered;
}

describe('F-2310 host-key questions of the jump hosts through real quick picks (card #2686)', function () {
  this.timeout(300_000);

  it('F-2310 AC-2, AC-3 (c2610-focus-one-jump): behind one jump host with unknown keys the two picks, the jump host’s and then the target’s, are each answered by Enter while they hold focus, and the window connects with one known-hosts line for each hop', async () => {
    const alias = 'c2610-focus-one';
    const known = freshKnown(alias);
    const target = await startHostSshd(FIRST_PORT);
    try {
      const jumpKey = await harnessHostFingerprint();
      let picks: AnsweredPick[] = [];
      const result = await connectWith(
        alias,
        [],
        'connects',
        outcome => ({
          indicator: outcome.indicator,
          known: knownHosts(known),
        }),
        {
          file: oneJump(alias, known),
          script: null,
          settings: {'remote.SSH.remotePlatform': {[alias]: 'linux'}},
          during: async name => {
            picks = await answeredByEnter(name, 2);
          },
        },
      );
      deepStrictEqual(
        {
          titles: picks.map(pick => pick.title),
          items: picks.map(pick => pick.items),
          focused: picks.map(pick => pick.focused),
          holdsFocus: picks.map(pick => pick.holdsFocus),
          ...result,
        },
        {
          titles: [pickOf(alias, jumpKey), pickOf(alias, target.fingerprint)],
          items: [
            ['Continue', 'Cancel'],
            ['Continue', 'Cancel'],
          ],
          focused: [['Continue'], ['Continue']],
          holdsFocus: [true, true],
          indicator: `SSH: ${alias}`,
          known: [
            `[127.0.0.1]:${String(hostPort())}`,
            `[127.0.0.1]:${String(FIRST_PORT)}`,
          ],
        },
      );
    } finally {
      await target.stop();
    }
  });

  it('F-2310 AC-4 (c2610-focus-two-jumps): with ProxyJump a,b and all keys unknown three fingerprint picks come in the order first jump, second jump, target, each answered by Enter while it holds focus, and the window connects', async () => {
    const alias = 'c2610-focus-chain';
    const known = freshKnown(alias);
    const first = await startHostSshd(FIRST_PORT);
    const second = await startHostSshd(SECOND_PORT);
    try {
      const firstKey = await harnessHostFingerprint();
      let picks: AnsweredPick[] = [];
      const result = await connectWith(
        alias,
        [],
        'connects',
        outcome => ({
          indicator: outcome.indicator,
          known: knownHosts(known).length,
        }),
        {
          file: twoJumps(alias, known),
          script: null,
          settings: {'remote.SSH.remotePlatform': {[alias]: 'linux'}},
          during: async name => {
            picks = await answeredByEnter(name, 3);
          },
        },
      );
      deepStrictEqual(
        {
          titles: picks.map(pick => pick.title),
          focused: picks.map(pick => pick.focused),
          holdsFocus: picks.map(pick => pick.holdsFocus),
          ...result,
        },
        {
          titles: [
            pickOf(alias, firstKey),
            pickOf(alias, first.fingerprint),
            pickOf(alias, second.fingerprint),
          ],
          focused: [['Continue'], ['Continue'], ['Continue']],
          holdsFocus: [true, true, true],
          indicator: `SSH: ${alias}`,
          known: 3,
        },
      );
    } finally {
      await second.stop();
      await first.stop();
    }
  });
});
