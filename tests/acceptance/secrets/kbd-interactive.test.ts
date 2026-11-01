/**
 * @fileoverview F-2306 AC-27 (card tooling-34): logins with a password and a one-time code, and with a forced password
 * change, on the Ubuntu 26.04 host's keyboard-interactive accounts, successful or not; once they are over, none of the
 * typed values is in a file of the client or the host. The launch's script is the harness playing the user, so it is
 * not searched.
 */

import {deepStrictEqual} from 'node:assert';
import {randomInt} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {newPassword} from '../../../tools/acceptance-run.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  editorLogsFolder,
  hostPassword,
  isOpen,
  openWindow,
  recordLines,
  type SecretPlace,
  secretHits,
  totpCode,
  variable,
  waitFor,
} from '../windows/harness.ts';

/** The length of one step of the host's codes; the host takes the step before and after the current one too. */
const STEP_MILLISECONDS = 30_000;

/** How long a login may take to end in a connect or a failure dialog. */
const LOGIN_MILLISECONDS = 120_000;

/** The parts of the questions the script's entries match, longest first, so a question is named by the one it holds. */
const QUESTION_PARTS = [
  'Retype new password',
  'Current password',
  'New password',
  'verification code',
  'password',
];

/** The run's folder, and the launch's own HOME under it. */
const RUN_FOLDER = variable('HARNESS_RUN_FOLDER');
const HOME_FOLDER = path.join(RUN_FOLDER, 'home-secrets');

/** The new password of the forced change, made by the run of the rows. */
const NEW_PASSWORD = newPassword();

/** The codes the rows type: a wrong one, and the one of the successful login. */
const typedCodes: string[] = [];

/** A six-digit code that is none of the three the host takes now, drawn at random so no file holds it by chance. */
function wrongCode(): string {
  const taken = new Set(
    [-STEP_MILLISECONDS, 0, STEP_MILLISECONDS].map(offset =>
      totpCode(Date.now() + offset),
    ),
  );
  for (;;) {
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    if (!taken.has(code)) {
      return code;
    }
  }
}

/** The questions window `name` was asked in masked inputs, each named by the part of it the script matches. */
function questionsOf(name: string): Array<string | undefined> {
  return recordLines('maskedInput', name).map(line =>
    QUESTION_PARTS.find(part => line.question.includes(part)),
  );
}

/** Waits until window `name` shows its failure dialog. */
function failedWithin(name: string): Promise<void> {
  return waitFor(
    `${name} to show its failure dialog`,
    () => recordLines('failureDialog', name).length > 0,
    LOGIN_MILLISECONDS,
  );
}

/** The script entries of a forced change on window `name` whose retype is `retyped`. */
function forcedChange(name: string, retyped: string) {
  return [
    {
      surface: 'maskedInput',
      match: 'password',
      answer: {text: hostPassword()},
      window: name,
    },
    {
      surface: 'maskedInput',
      match: 'Current password',
      answer: {text: hostPassword()},
      window: name,
    },
    {
      surface: 'maskedInput',
      match: 'New password',
      answer: {text: NEW_PASSWORD},
      window: name,
    },
    {
      surface: 'maskedInput',
      match: 'Retype new password',
      answer: {text: retyped},
      window: name,
    },
  ] as const;
}

/** The places of the client and the host every typed password is searched in. */
function allPlaces(): SecretPlace[] {
  return [
    {client: HOME_FOLDER},
    {client: variable('HARNESS_USER_DATA')},
    {client: editorLogsFolder()},
    ...readdirSync(RUN_FOLDER)
      .filter(name => name.startsWith('extensions'))
      .map(name => ({client: path.join(RUN_FOLDER, name)})),
    {client: variable('REMOTE_OSS_ACCEPTANCE_LOG')},
    {client: variable('REMOTE_OSS_ACCEPTANCE_RECORD')},
    ...[
      '/home/harness-2fa',
      '/home/harness-expired',
      '/tmp',
      '/var/tmp',
      '/var/log',
    ].map(folder => ({host: folder})),
    {hostLog: true},
  ];
}

/** Whether `file` is a log file. */
function isLog(file: string): boolean {
  return file.endsWith('.log');
}

/**
 * The places a six-digit code is searched in: where the product writes what it is told. A binary file can hold any six
 * digits by chance, and the host's one-time-code file is the harness's own seed.
 */
function textPlaces(): SecretPlace[] {
  return [
    {client: variable('REMOTE_OSS_ACCEPTANCE_LOG')},
    {client: variable('REMOTE_OSS_ACCEPTANCE_RECORD')},
    {client: editorLogsFolder(), accepted: isLog},
    {client: path.join(variable('HARNESS_USER_DATA'), 'logs'), accepted: isLog},
    {
      client: path.join(
        variable('HARNESS_USER_DATA'),
        'User',
        'globalStorage',
        'remote-oss.remote-ssh',
      ),
    },
    {hostLog: true},
    {host: '/home/harness-2fa', excluded: ['.google_authenticator']},
    {host: '/home/harness-expired'},
  ];
}

describe('keyboard-interactive logins type nothing into a file (F-2306 AC-27, card tooling-34)', function () {
  this.timeout(600_000);

  it('F-2306 AC-27 (wrong-code): a password and a wrong code fail the login, the next round is cancelled, and the failure dialog shows', async () => {
    const wrong = wrongCode();
    typedCodes.push(wrong);
    appendScript([
      {
        surface: 'maskedInput',
        match: 'password',
        answer: {text: hostPassword()},
        window: 'k1',
      },
      {
        surface: 'maskedInput',
        match: 'verification code',
        answer: {text: wrong},
        window: 'k1',
      },
      {
        surface: 'maskedInput',
        match: 'password',
        answer: 'dismiss',
        window: 'k1',
      },
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: 'dismiss',
        window: 'k1',
      },
    ]);
    await openWindow('twofactor', 'k1', 'harness-2fa');
    await failedWithin('k1');
    deepStrictEqual(questionsOf('k1'), [
      'password',
      'verification code',
      'password',
    ]);
  });

  it('F-2306 AC-27 (two-factor): a password and the current code log in', async () => {
    const code = totpCode();
    typedCodes.push(code);
    appendScript([
      {
        surface: 'maskedInput',
        match: 'password',
        answer: {text: hostPassword()},
        window: 'k2',
      },
      {
        surface: 'maskedInput',
        match: 'verification code',
        answer: {text: code},
        window: 'k2',
      },
    ]);
    await openWindow('twofactor', 'k2', 'harness-2fa');
    await connectedWithin('k2', LOGIN_MILLISECONDS, 'harness-2fa');
    deepStrictEqual(questionsOf('k2'), ['password', 'verification code']);
  });

  it('F-2306 AC-27 (mismatched-retype): a retype that differs fails the change, the next round is cancelled, and the failure dialog shows', async () => {
    appendScript([
      ...forcedChange('k3', `${NEW_PASSWORD}x`),
      {
        surface: 'maskedInput',
        match: 'password',
        answer: 'dismiss',
        window: 'k3',
      },
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: 'dismiss',
        window: 'k3',
      },
    ]);
    await openWindow('expired', 'k3', 'harness-expired');
    await failedWithin('k3');
    deepStrictEqual(questionsOf('k3'), [
      'password',
      'Current password',
      'New password',
      'Retype new password',
      'password',
    ]);
  });

  it('F-2306 AC-27 (forced-change): the current password and a new one typed twice log in', async () => {
    appendScript(forcedChange('k4', NEW_PASSWORD));
    await openWindow('expired', 'k4', 'harness-expired');
    await connectedWithin('k4', LOGIN_MILLISECONDS, 'harness-expired');
    deepStrictEqual(questionsOf('k4'), [
      'password',
      'Current password',
      'New password',
      'Retype new password',
    ]);
  });

  it('F-2306 AC-27: once the logins are over and every window is closed, no password, new password or code is in a file of the client or the host', async () => {
    for (const name of ['k1', 'k2', 'k3', 'k4']) {
      if (isOpen(name)) {
        await closeWindow(name);
      }
    }
    // The controls: the search finds a value where the harness itself keeps it, on the client and on the host.
    const secret = readFileSync(variable('HARNESS_TOTP_FILE'), 'utf8');
    deepStrictEqual(
      [
        secretHits(
          [hostPassword(), NEW_PASSWORD, `${NEW_PASSWORD}x`],
          allPlaces(),
        ),
        secretHits(typedCodes, textPlaces()),
        secretHits(
          [secret],
          [
            {client: variable('HARNESS_TOTP_FILE')},
            {host: '/home/harness-2fa'},
          ],
        ).map(found => path.basename(found.file)),
      ],
      [[], [], ['totp-secret', '.google_authenticator']],
    );
  });
});
