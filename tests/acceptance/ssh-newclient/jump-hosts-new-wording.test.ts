/**
 * @fileoverview F-2310's host-key questions of the jump hosts in the wording of OpenSSH 10.2, on the pinned client
 * (card #2610): every hop's question is F-2305's fingerprint pick, told apart by its fingerprint, in both modes, and
 * the unanswered one of terminal mode ends with the dialog. The hops have keys of their own: the harness
 * host's sshd, and user-level sshds behind it.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {hostPort, recordLines} from '../windows/harness.ts';
import {
  ASK_WITHOUT,
  askLines,
  connectWith,
  freshKnown,
  harnessHostFingerprint,
  hostBlock,
  MODES,
  startHostSshd,
  writeConfig,
} from '../windows/config-keywords-support.ts';

/** The first user-level sshd's port, which a hop behind the harness host shows its own key on, and the second's. */
const FIRST_PORT = 22022;
const SECOND_PORT = 22023;

/** The pick question of a hop whose host key has `fingerprint`, for window `alias`. */
function pickOf(alias: string, fingerprint: string | undefined): string {
  return `"${alias}" has fingerprint "${String(fingerprint)}".`;
}

/** The questions of the fingerprint pick that window `alias` was asked and answered, in order. */
function picksOf(alias: string): string[] {
  return recordLines('pick', alias)
    .filter(line => line.answer !== 'held')
    .map(line => line.question);
}

/** How many questions of the free-text and masked input surfaces window `alias` was asked. */
function inputsOf(alias: string): number {
  return (
    recordLines('textInput', alias).length +
    recordLines('maskedInput', alias).length
  );
}

/** The host columns of the lines of the known-hosts file `known`, in file order. */
function knownHosts(known: string): string[] {
  return readFileSync(known, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split(' ')[0] ?? '');
}

/** The entries of the script that answer the fingerprint pick `count` times with Continue. */
function continues(alias: string, count: number) {
  return Array.from({length: count}, () => ({
    surface: 'pick',
    match: 'fingerprint',
    answer: 'yes',
    window: alias,
  })) as Array<{
    surface: 'pick';
    match: string;
    answer: 'yes';
    window: string;
  }>;
}

/** The file of a row with one jump host, the harness host's sshd, and a target at the first user-level sshd behind it. */
function oneJump(alias: string, known: string): string {
  return writeConfig(alias, [
    hostBlock(
      alias,
      [
        `ProxyJump ${alias}-hop`,
        'HostName 127.0.0.1',
        `Port ${String(FIRST_PORT)}`,
        ...askLines(known),
      ],
      ['Port', 'HostName', ...ASK_WITHOUT],
    ),
    hostBlock(`${alias}-hop`, askLines(known), ASK_WITHOUT),
  ]);
}

/** The settings of the terminal mode with the login terminal `shown` or hidden, and the platform named so that no pick of it is asked. */
function terminalSettings(alias: string, shown: boolean) {
  return {
    ...MODES[1].settings,
    'remote.SSH.showLoginTerminal': shown,
    'remote.SSH.remotePlatform': {[alias]: 'linux'},
  };
}

describe('F-2310 host-key questions in the wording of OpenSSH 10.2 (card #2610)', function () {
  this.timeout(300_000);

  /** Connects window `alias` behind one jump host, both keys unknown, and gives what it showed. */
  async function behindOneJump(alias: string) {
    const known = freshKnown(alias);
    const second = await startHostSshd(FIRST_PORT);
    try {
      const jumpKey = await harnessHostFingerprint();
      const shown = await connectWith(
        alias,
        [],
        'connects',
        outcome => ({
          progress: outcome.progress[0],
          picks: picksOf(alias),
          inputs: inputsOf(alias),
          indicator: outcome.indicator,
          known: knownHosts(known),
        }),
        {
          file: oneJump(alias, known),
          script: continues(alias, 2),
          settings: {'remote.SSH.remotePlatform': {[alias]: 'linux'}},
        },
      );
      return {shown, jumpKey, targetKey: second.fingerprint};
    } finally {
      await second.stop();
    }
  }

  it('F-2310 AC-1 (c2610-first-pick): behind a jump host with unknown keys the window opens with the progress of the host and asks the fingerprint pick of the jump host first, with no input', async () => {
    const alias = 'c2610-first';
    const {shown, jumpKey} = await behindOneJump(alias);
    deepStrictEqual(
      [shown.progress, shown.picks[0], shown.inputs],
      [`Setting up SSH Host ${alias}`, pickOf(alias, jumpKey), 0],
    );
  });

  it('F-2310 AC-2, AC-3 (c2610-picks-one-jump-part): the second pick is the target’s, told apart by its fingerprint, and Continue on each pick records one known-hosts line for each hop and connects; whether each pick holds focus when it is answered is not asserted', async () => {
    const alias = 'c2610-one-jump';
    const {shown, jumpKey, targetKey} = await behindOneJump(alias);
    deepStrictEqual(shown, {
      progress: `Setting up SSH Host ${alias}`,
      picks: [pickOf(alias, jumpKey), pickOf(alias, targetKey)],
      inputs: 0,
      indicator: `SSH: ${alias}`,
      known: [
        `[127.0.0.1]:${String(hostPort())}`,
        `[127.0.0.1]:${String(FIRST_PORT)}`,
      ],
    });
  });

  it('F-2310 AC-4 (c2610-picks-chain-part): ProxyJump a,b with all keys unknown asks three fingerprint picks in the order first jump, second jump, target, each answered with Continue, and the window connects; whether each holds focus when it is answered is not asserted', async () => {
    const alias = 'c2610-chain';
    const known = freshKnown(alias);
    const first = await startHostSshd(FIRST_PORT);
    const second = await startHostSshd(SECOND_PORT);
    try {
      const firstKey = await harnessHostFingerprint();
      const file = writeConfig(alias, [
        hostBlock(
          alias,
          [
            `ProxyJump ${alias}-a,${alias}-b`,
            'HostName 127.0.0.1',
            `Port ${String(SECOND_PORT)}`,
            ...askLines(known),
          ],
          ['Port', 'HostName', ...ASK_WITHOUT],
        ),
        hostBlock(`${alias}-a`, askLines(known), ASK_WITHOUT),
        hostBlock(
          `${alias}-b`,
          [
            'HostName 127.0.0.1',
            `Port ${String(FIRST_PORT)}`,
            ...askLines(known),
          ],
          ['Port', 'HostName', ...ASK_WITHOUT],
        ),
      ]);
      const result = await connectWith(
        alias,
        [],
        'connects',
        outcome => ({
          picks: picksOf(alias),
          indicator: outcome.indicator,
          known: knownHosts(known).length,
        }),
        {
          file,
          script: continues(alias, 3),
          settings: {'remote.SSH.remotePlatform': {[alias]: 'linux'}},
        },
      );
      deepStrictEqual(result, {
        picks: [
          pickOf(alias, firstKey),
          pickOf(alias, first.fingerprint),
          pickOf(alias, second.fingerprint),
        ],
        indicator: `SSH: ${alias}`,
        known: 3,
      });
    } finally {
      await second.stop();
      await first.stop();
    }
  });

  it('F-2310 AC-34 (c2610-picks-unanswered): without the local server and with the login terminal hidden, a jump host pick nobody answers for 15 seconds ends with the dialog without a reason', async () => {
    const alias = 'c2610-unanswered';
    const known = freshKnown(alias);
    const second = await startHostSshd(FIRST_PORT);
    try {
      const result = await connectWith(
        alias,
        [],
        'fails',
        outcome => ({
          dialog: outcome.dialog,
          within:
            (outcome.failedAfter ?? 0) >= 10_000 &&
            (outcome.failedAfter ?? 0) < 40_000,
          picks: recordLines('pick', alias).length,
        }),
        {
          file: oneJump(alias, known),
          script: [
            {
              surface: 'pick',
              match: 'fingerprint',
              answer: 'yes',
              window: alias,
              after: 'c2610-never-answered',
            },
            {
              surface: 'failureDialog',
              match: 'Could not establish connection',
              answer: 'dismiss',
              window: alias,
            },
            {
              surface: 'mitigationPick',
              match: 'Pick an action',
              answer: 'dismiss',
              window: alias,
            },
          ],
          settings: terminalSettings(alias, false),
        },
      );
      deepStrictEqual(result, {
        dialog: `Could not establish connection to "${alias}".`,
        within: true,
        picks: 2,
      });
    } finally {
      await second.stop();
    }
  });
});
