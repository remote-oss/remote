/**
 * @fileoverview F-2310's host-key questions of the jump hosts through real quick picks (card #2686): each fingerprint
 * pick is answered by Enter while it holds the keyboard focus, and the terminal mode draws no pick and no input at all.
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
  terminalSettings,
  twoJumps,
} from '../windows/jump-pick-support.ts';
import {
  inputBoxOf,
  pressEnter,
  quickPickHasFocus,
  quickPickOf,
  quickPickRows,
  quickPickTitle,
  terminalText,
  typeInTerminal,
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

/** The end of the question that ssh asks in its terminal about a host key. */
const QUESTION_END = '(yes/no/[fingerprint])?';

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

/** What window `name` showed while it asked its host-key questions in its login terminal and they were answered with yes. */
interface TypedQuestions {
  /** The fingerprints that were answered, in the order of the answers. */
  fingerprints: string[];
  /** Whether a quick pick or an input box was drawn at any time. */
  drawn: boolean;
  /** The text of the terminal when the last question was answered. */
  text: string;
}

/** Answers `count` host-key questions of window `name`'s login terminal with `yes`, and watches the quick input all the while. */
async function typedYes(name: string, count: number): Promise<TypedQuestions> {
  const result: TypedQuestions = {fingerprints: [], drawn: false, text: ''};
  const deadline = Date.now() + QUESTION_MILLISECONDS;
  while (result.fingerprints.length < count && Date.now() < deadline) {
    result.drawn ||=
      (await quickPickOf(name)) !== undefined ||
      (await inputBoxOf(name)) !== undefined;
    const text = await terminalText(name);
    const last = text.match(/SHA256:[A-Za-z0-9+/]+/gu)?.at(-1);
    if (
      last !== undefined &&
      text.trimEnd().endsWith(QUESTION_END) &&
      !result.fingerprints.includes(last)
    ) {
      result.text = text;
      await typeInTerminal(name, 'yes\n');
      result.fingerprints.push(last);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return result;
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
          script: [],
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
          script: [],
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

  it('F-2310 AC-37 (c2610-terminal-yes): without the local server and with the login terminal shown no pick and no input is drawn for any hop, each hop’s host-key question is answered by typing yes in the terminal, the jump host’s first, and the window connects', async () => {
    const alias = 'c2610-terminal-yes';
    const known = freshKnown(alias);
    const target = await startHostSshd(FIRST_PORT);
    try {
      const jumpKey = await harnessHostFingerprint();
      let typed: TypedQuestions | undefined;
      const result = await connectWith(
        alias,
        [],
        'connects',
        outcome => ({
          indicator: outcome.indicator,
          known: knownHosts(known).length,
        }),
        {
          file: oneJump(alias, known),
          script: [],
          settings: terminalSettings(alias, true),
          during: async name => {
            typed = await typedYes(name, 2);
          },
        },
      );
      deepStrictEqual(
        {
          fingerprints: typed?.fingerprints,
          drawn: typed?.drawn,
          asked: typed?.text.includes('Are you sure you want to continue'),
          ...result,
        },
        {
          fingerprints: [jumpKey, target.fingerprint],
          drawn: false,
          asked: true,
          indicator: `SSH: ${alias}`,
          known: 2,
        },
      );
    } finally {
      await target.stop();
    }
  });
});
