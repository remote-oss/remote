import {deepStrictEqual} from 'node:assert';
import {closeWindow, openWindow, waitFor} from '../windows/harness.ts';
import {notifications, waitForDialog} from '../windows/renderer.ts';
import {setUserSetting} from '../windows/folder-windows.ts';

describe('a question the extension does not recognise, on the account harness-odd (card coverage-82)', function () {
  this.timeout(400_000);

  after(async () => {
    await setUserSetting('remote.SSH.showLoginTerminal', true);
  });

  it('F-2308 AC-12 (c82-odd-dropped): with the login terminal hidden and a question the extension does not recognise left unanswered, the failure dialog appears after the connect wait, well before the server drops the login', async () => {
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
      const dialog = await waitForDialog(name, 240_000);
      const seconds = (Date.now() - asked) / 1000;
      deepStrictEqual(
        {
          details: dialog.details,
          buttons: [...dialog.buttons].sort(),
          afterTheConnectWait: seconds >= 10 && seconds <= 16,
          seconds,
        },
        {
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
