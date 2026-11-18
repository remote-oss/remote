/**
 * @fileoverview The two fixed rows of card #2608, five cold rounds each (hermes' load standard, one dispatch): the
 * F-2310 AC-10 chain held open until the timeout, and the F-2105 AC-14 other-case stand-in. A measurement file:
 * it is removed when the five rounds are green.
 */

import {deepStrictEqual} from 'node:assert';
import {chmodSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  connectionLog,
  hostPort,
  recordLines,
  sshdLog,
  variable,
} from '../windows/harness.ts';
import {
  ASK_WITHOUT,
  askLines,
  connectWith,
  freshKnown,
  hostBlock,
  writeConfig,
} from '../windows/config-keywords-support.ts';

/** The dialog without a reason that a failed connect of `alias` shows. */
function reasonless(alias: string): string {
  return `Could not establish connection to "${alias}".`;
}

/** The chain `ProxyJump a,b` of a row that asks every host key; no ConnectTimeout, which ssh would apply to the jump hosts' own handshakes. */
function chain(alias: string, known: string): string {
  return writeConfig(alias, [
    hostBlock(
      alias,
      [
        `ProxyJump ${alias}-first,${alias}-second`,
        'HostName 127.0.0.2',
        'Port 22',
        ...askLines(known),
      ],
      ['Port', 'HostName', 'ConnectTimeout', ...ASK_WITHOUT],
    ),
    hostBlock(`${alias}-first`, askLines(known), [
      'ConnectTimeout',
      ...ASK_WITHOUT,
    ]),
    hostBlock(
      `${alias}-second`,
      ['HostName 127.0.0.3', 'Port 22', ...askLines(known)],
      ['Port', 'HostName', 'ConnectTimeout', ...ASK_WITHOUT],
    ),
  ]);
}

/** The row of F-2310 AC-10: the held pick and the timeout reason while it is open. */
async function jumpTimeoutOpen(alias: string): Promise<void> {
  const since = new Date().toISOString();
  const file = chain(alias, freshKnown(alias));
  try {
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => {
        const picks = recordLines('pick', alias);
        const first = picks[0];
        const answered = picks.find(line => line.answer !== 'held');
        const dialogTime = outcome.dialogTime ?? 0;
        return {
          dialog: outcome.dialog,
          stillOpen:
            first?.held === true &&
            first.time < dialogTime &&
            (answered === undefined || answered.time >= dialogTime),
        };
      },
      {
        file,
        script: [
          {
            surface: 'pick',
            match: 'fingerprint',
            answer: 'dismiss',
            window: alias,
            after: 'never',
          },
        ],
      },
    );
    deepStrictEqual(result, {
      dialog: `Could not establish connection to "${alias}": The connection timed out.`,
      stillOpen: true,
    });
  } catch (caught) {
    const sshd = (await sshdLog(since)).join('\n');
    throw new Error(
      `${String(caught)}\nthe connection log:\n${connectionLog()
        .slice(-40)
        .join('\n')}\nthe host's sshd log since the row began:\n${sshd}`,
      {cause: caught},
    );
  }
}

/** The row of F-2105 AC-14's other case: the stand-in that answers the locate step and times out in another case. */
async function caselessTimeoutReason(alias: string): Promise<void> {
  const folder = variable('HARNESS_RUN_FOLDER');
  const standIn = path.join(folder, `${alias}-ssh.sh`);
  const standInLog = path.join(folder, `${alias}-ssh.log`);
  const port = hostPort();
  writeFileSync(
    standIn,
    [
      '#!/bin/bash',
      `log="${folder}/${alias}-ssh.log"`,
      '{',
      '  echo "invoked: $0"',
      '  for arg in "$@"; do echo "arg: $arg"; done',
      '} >> "$log"',
      'if [ "$1" = "-V" ]; then',
      '  echo "OpenSSH_9.6p1 Ubuntu-3ubuntu13.20, OpenSSL 3.0.13 30 Jan 2024"',
      '  exit 0',
      'fi',
      'for arg in "$@"; do',
      '  if [ "$arg" = "-G" ]; then',
      '    echo hostname 127.0.0.1',
      '    echo user harness',
      `    echo port ${String(port)}`,
      '    exit 0',
      '  fi',
      'done',
      'echo "ssh: connect to host h port 22: Connection Timed Out" >&2',
      'exit 255',
      '',
    ].join('\n'),
  );
  chmodSync(standIn, 0o755);
  const file = writeConfig(alias, [hostBlock(alias, [], [])]);
  try {
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => outcome.dialog,
      {file, script: null, settings: {'remote.SSH.path': standIn}},
    );
    deepStrictEqual(result, reasonless(alias));
  } catch (caught) {
    let standInText: string;
    try {
      standInText = readFileSync(standInLog, 'utf8');
    } catch (unread) {
      standInText = `the stand-in wrote no log: ${String(unread)}`;
    }
    throw new Error(
      `${String(caught)}\nthe stand-in's log:\n${standInText}\nthe connection log:\n${connectionLog()
        .slice(-40)
        .join('\n')}`,
      {cause: caught},
    );
  }
}

describe('card #2608 load check: the two fixed rows, five cold rounds each', function () {
  this.timeout(300_000);

  for (let round = 1; round <= 5; round += 1) {
    it(`round ${String(round)} of 5, F-2310 AC-10 (c2608-jump-timeout-open): the two-jump chain with unknown keys and no answers times out with the timeout reason while the first jump host's pick is still open`, async () => {
      await jumpTimeoutOpen(`c2608-jumpopen-r${String(round)}`);
    });

    it(`round ${String(round)} of 5, F-2105.AC-14 (c2608-caseless-timeout-reason): ssh error text with the timeout in another case, "Connection Timed Out", fails with no reason`, async () => {
      await caselessTimeoutReason(`c2608-caseless-r${String(round)}`);
    });
  }
});
