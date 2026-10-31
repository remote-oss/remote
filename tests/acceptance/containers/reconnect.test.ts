import {deepStrictEqual} from 'node:assert';
import {closeWindow} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {
  COUNTDOWN,
  docker,
  eventually,
  settledWindow as connectedWindow,
} from './resolve-support.ts';
import {
  answerDialog,
  dialogOf,
  statusBarText,
  toastDetails,
  waitForDialog,
} from '../windows/renderer.ts';

describe('F-0409 a connected window whose container changes outside the editor (card containers-61)', function () {
  this.timeout(600_000);

  it('F-0409 AC-8 (r8): a container stopped outside the editor gives core’s Cannot reconnect dialog within a few seconds, with the indicator disconnected', async () => {
    const {name, containerId, folder} = await connectedWindow('c61-stop');
    try {
      const began = Date.now();
      await docker('stop', containerId);
      const dialog = await waitForDialog(name, 30_000);
      const seconds = (Date.now() - began) / 1000;
      const indicator = await statusBarText(name, 'status.host');
      await answerDialog(name, 'Cancel');
      deepStrictEqual(
        {
          message: dialog.message,
          details: dialog.details,
          buttons: [...dialog.buttons],
          withinFiveSeconds: seconds < 5,
          indicator,
        },
        {
          message: '',
          details: 'Cannot reconnect. Please reload the window.',
          buttons: ['Cancel', 'Reload Window'],
          withinFiveSeconds: true,
          indicator: 'Disconnected from Dev Container: c61-stop',
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-10, AC-23 (r10): a paused container shows Reconnecting in the indicator, then the countdown dialog, which Reconnect Now restarts and Dismiss turns into a notification', async () => {
    const {name, containerId, folder} = await connectedWindow('c61-pause');
    try {
      const began = Date.now();
      await docker('pause', containerId);
      const reconnecting = await eventually(
        'the Reconnecting indicator',
        async () => {
          const text = await statusBarText(name, 'status.host');
          return text.startsWith('Reconnecting to Dev Container:')
            ? text
            : undefined;
        },
        60_000,
      );
      const reconnectingAt = (Date.now() - began) / 1000;
      const first = await eventually(
        'the countdown dialog',
        async () => {
          const shown = await dialogOf(name);
          return shown !== undefined && COUNTDOWN.test(shown.details)
            ? shown
            : undefined;
        },
        90_000,
      );
      await answerDialog(name, 'Reconnect Now');
      const restarted = await eventually(
        'the countdown to restart',
        async () => {
          const shown = await dialogOf(name);
          return shown !== undefined && COUNTDOWN.test(shown.details)
            ? shown
            : undefined;
        },
        30_000,
      );
      await answerDialog(name, 'Dismiss');
      const notice = await eventually(
        'the countdown notification',
        async () =>
          (await toastDetails(name)).find(toast =>
            toast.message.startsWith('Attempting to reconnect in'),
          ),
        30_000,
      );
      const returned = await eventually(
        'the dialog to return',
        async () => {
          const shown = await dialogOf(name);
          return shown !== undefined && COUNTDOWN.test(shown.details)
            ? shown
            : undefined;
        },
        90_000,
      );
      deepStrictEqual(
        {
          reconnecting,
          reconnectingBetween: reconnectingAt > 10 && reconnectingAt < 40,
          first: [COUNTDOWN.test(first.details), [...first.buttons]],
          restarted: [
            COUNTDOWN.test(restarted.details),
            [...restarted.buttons],
          ],
          notice: [COUNTDOWN.test(notice.message), [...notice.buttons]],
          returned: [COUNTDOWN.test(returned.details), [...returned.buttons]],
        },
        {
          reconnecting: 'Reconnecting to Dev Container: c61-pause...',
          reconnectingBetween: true,
          first: [true, ['Reload Window', 'Dismiss', 'Reconnect Now']],
          restarted: [true, ['Reload Window', 'Dismiss', 'Reconnect Now']],
          notice: [true, ['Reconnect Now', 'Reload Window']],
          returned: [true, ['Reload Window', 'Dismiss', 'Reconnect Now']],
        },
      );
    } finally {
      await docker('unpause', containerId).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
