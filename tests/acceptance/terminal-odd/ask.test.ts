import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  openWindow,
  terminalFacts,
  waitFor,
} from '../windows/harness.ts';
import {
  clickToastLink,
  dialogOf,
  notifications,
  quickPickOf,
  waitForDialog,
} from '../windows/renderer.ts';
import {setUserSetting} from '../windows/folder-windows.ts';

describe('a question the extension does not recognise, on the account harness-odd (card coverage-82)', function () {
  this.timeout(400_000);

  after(async () => {
    await setUserSetting('remote.SSH.showLoginTerminal', true);
  });

  it('F-2308 AC-12 (ruling-299-question-bound): with the login terminal hidden and a question the extension does not recognise left unanswered, the failure dialog appears after the connect wait, well before the server drops the login', async () => {
    await setUserSetting('remote.SSH.showLoginTerminal', false);
    const name = 'c82-odd-dropped';
    await openWindow('ask-odd', name, 'harness-odd');
    try {
      await waitFor(
        'the progress notification',
        async () =>
          (await notifications(name)).some(text =>
            text.startsWith('Setting up SSH Host'),
          ),
        60_000,
      );
      // The host's ConnectTimeout is 10 s and the wait adds 2 s; sshd drops the login only at its 120 s.
      const asked = Date.now();
      await new Promise(resolve => setTimeout(resolve, 3000));
      // AC-9's surfaces are quiet while the question waits: no input, no dialog, only the progress.
      const quiet = {
        quick: await quickPickOf(name),
        dialog: await dialogOf(name),
        toasts: (await notifications(name)).map(text =>
          text.slice(0, 'Setting up SSH Host'.length),
        ),
      };
      // The question was asked: the terminal, revealed by the details link, holds the keyboard-interactive prompt of the account.
      await clickToastLink(name, 'Setting up SSH Host', 'details');
      let held = '';
      try {
        await waitFor(
          'the keyboard-interactive question in the terminal',
          async () => {
            held =
              (await terminalFacts(name).catch(() => undefined))?.text ?? '';
            // The terminal was laid out narrow while hidden, so its buffer holds the start of the prompt line.
            return (
              held.includes(
                'Next authentication method: keyboard-interactive',
              ) && held.includes('(harness-odd@127.0.0')
            );
          },
          5000,
        );
      } catch (error) {
        throw new Error(
          `${(error as Error).message}; it held ${JSON.stringify(held.slice(-400))}`,
          {cause: error},
        );
      }
      const dialog = await waitForDialog(name, 240_000);
      const seconds = (Date.now() - asked) / 1000;
      deepStrictEqual(
        {
          quiet,
          details: dialog.details,
          buttons: [...dialog.buttons].sort(),
          afterTheConnectWait: seconds >= 10 && seconds <= 16,
          seconds,
        },
        {
          quiet: {
            quick: undefined,
            dialog: undefined,
            toasts: ['Setting up SSH Host'],
          },
          details:
            'Could not establish connection to "ask-odd": Connecting with SSH timed out.',
          buttons: ['Close Remote', 'More Actions...', 'Retry'],
          afterTheConnectWait: true,
          seconds,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });
});
