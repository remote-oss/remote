import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  openWindow,
  recordLines,
  userSettings,
} from '../windows/harness.ts';
import {password} from '../windows/maintenance.ts';
import {notifications} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** The account of the `password-retry` alias, which asks for its password up to three times. */
const ACCOUNT = 'harness-pwonly';

/** The line ssh writes before it asks for the password again. */
const REFUSED_LINE = 'Permission denied, please try again.';

/** Opens a window through `password-retry`, answers a wrong password and then the right one, and gives what the two inputs and the connect showed. */
async function wrongThenRight(name: string) {
  appendScript([
    {
      surface: 'maskedInput',
      match: 'Enter password',
      answer: {text: 'not-the-password'},
      window: name,
    },
    {...password(), window: name},
  ]);
  await openWindow('password-retry', name, ACCOUNT);
  await connectedWithin(name, 120_000, ACCOUNT);
  const inputs = recordLines('maskedInput', name);
  const shown = {
    messages: inputs.map(line => line.message),
    same: inputs[0]?.question === inputs[1]?.question,
    toasts: (await notifications(name)).filter(
      text => !text.startsWith('Setting up SSH Host'),
    ),
  };
  await closeWindow(name).catch(() => undefined);
  return shown;
}

describe('a password asked again (card #2613)', function () {
  this.timeout(300_000);

  it('F-2306 AC-7 (c2613-message): in the shared connection a wrong password asks the same input again with ssh’s Permission denied line as its message, and no notification appears', async () => {
    await keepingSettings(async () => {
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.useLocalServer': true,
      });
      deepStrictEqual(await wrongThenRight('c2613-message'), {
        messages: [undefined, REFUSED_LINE],
        same: true,
        toasts: [],
      });
    });
  });

  it('F-2306 AC-9 (c2613-terminal): in the terminal mode a wrong password asks the same input again with no message of ours', async () => {
    await keepingSettings(async () => {
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.useLocalServer': false,
      });
      deepStrictEqual(await wrongThenRight('c2613-terminal'), {
        messages: [undefined, undefined],
        same: true,
        toasts: [],
      });
    });
  });
});
