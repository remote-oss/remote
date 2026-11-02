import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  onHost,
  openWindow,
  recordLines,
  terminalNames,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  answerDialog,
  notifications,
  waitForDialog,
} from '../windows/renderer.ts';

/** The question of core's trust request. */
const TRUST_QUESTION = 'Do you trust the authors of the files in this folder?';

/** How many sessions of the user harness the host's sshd has open. */
async function hostSessions(): Promise<number> {
  const listed = await onHost(
    'sh',
    '-c',
    "ps -o args | grep -c '[s]shd.*: harness@' || true",
  );
  return Number(listed.trim());
}

describe('the terminal mode in an untrusted folder (card coverage-82)', function () {
  this.timeout(300_000);

  it('F-2308 AC-17 (c82-trust-first): core’s trust dialog comes before the login terminal, and the terminal follows after Trust Folder & Continue', async () => {
    await openWindow('harness', 'c82-trust-first');
    try {
      const asked = await waitForDialog('c82-trust-first');
      // The terminal object exists, but its ssh has not run: the host's sessions of the user rise only after the trust.
      const before = await hostSessions();
      await answerDialog('c82-trust-first', 'Trust Folder & Continue');
      await waitFor(
        'the install terminal',
        async () =>
          (await terminalNames('c82-trust-first')).includes('install'),
        60_000,
      );
      await connectedWithin('c82-trust-first', INSTALL_MILLISECONDS);
      deepStrictEqual(
        [asked.message, before, (await hostSessions()) > before],
        [TRUST_QUESTION, before, true],
      );
    } finally {
      await closeWindow('c82-trust-first').catch(() => undefined);
    }
  });

  /** The entry that dismisses the failure dialog of window `window`, which the record then holds. */
  function dismissFailure(window: string): AppendedEntry {
    return {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    };
  }

  /** Waits until the record holds window `window`'s failure dialog, and gives it. */
  async function failureOf(window: string) {
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', window).length > 0,
      60_000,
    );
    return recordLines('failureDialog', window)[0];
  }

  it('F-2308 AC-24 (c82-trust-cancel): cancelling core’s trust dialog fails the attempt at once with the bad-result dialog, core’s untrusted-workspace notification, and no login terminal', async () => {
    appendScript([dismissFailure('c82-trust-cancel')]);
    await openWindow('harness', 'c82-trust-cancel');
    try {
      await waitForDialog('c82-trust-cancel');
      await answerDialog('c82-trust-cancel', 'Cancel');
      const failed = await failureOf('c82-trust-cancel');
      deepStrictEqual(
        {
          dialog: [failed?.question, [...(failed?.buttons ?? [])].sort()],
          toast: (await notifications('c82-trust-cancel')).some(text =>
            text.includes(
              'Cannot launch a terminal process in an untrusted workspace.',
            ),
          ),
          terminals: await terminalNames('c82-trust-cancel'),
        },
        {
          dialog: [
            'Could not establish connection to "harness": Got bad result from install script.',
            ['Close Remote', 'More Actions...', 'Retry'],
          ],
          toast: true,
          terminals: [],
        },
      );
    } finally {
      await closeWindow('c82-trust-cancel').catch(() => undefined);
    }
  });

  it('F-2308 AC-24 (c82-trust-wait): a trust dialog left unanswered fails the attempt after about the connect timeout plus 2 seconds with the timed-out detail', async () => {
    appendScript([dismissFailure('c82-trust-wait')]);
    try {
      await openWindow('harness', 'c82-trust-wait');
      await waitForDialog('c82-trust-wait');
      const asked = Date.now();
      const failed = await failureOf('c82-trust-wait');
      const seconds = (Date.now() - asked) / 1000;
      // The host harness sets ConnectTimeout 10, which the extension's setting yields to (F-2105): 10 s and the margin.
      deepStrictEqual(
        {
          details: failed?.question,
          about: seconds >= 11 && seconds <= 14,
          seconds,
        },
        {
          details:
            'Could not establish connection to "harness": Connecting with SSH timed out.',
          about: true,
          seconds,
        },
      );
    } finally {
      await closeWindow('c82-trust-wait').catch(() => undefined);
    }
  });
});
