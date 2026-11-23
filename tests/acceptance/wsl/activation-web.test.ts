import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, variable} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {pressControlAlt} from '../windows/renderer.ts';
import {effectsOf, runFolder} from './wsl-support.ts';

/** The message of a command that would open a WSL window in the browser. */
const WEB_REJECTION = 'Local hostAuthority resolutions are not possible in web';

/** Binds Ctrl+Alt and each letter to its command in the launch's profile; the function it returns puts the file back. */
function bindKeys(
  bindings: ReadonlyArray<readonly [string, string]>,
): () => void {
  const file = path.join(
    variable('HARNESS_USER_DATA'),
    'User/keybindings.json',
  );
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  writeFileSync(
    file,
    JSON.stringify(
      bindings.map(([letter, command]) => ({
        key: `ctrl+alt+${letter}`,
        command,
      })),
    ),
  );
  return () => {
    if (before === undefined) {
      rmSync(file, {force: true});
    } else {
      writeFileSync(file, before);
    }
  };
}

describe('WSL in the browser build, on a Linux desktop standing in for it (card #2365)', function () {
  this.timeout(300_000);

  it('F-6001 AC-42 (w08-web-no-probe): the browser build activates with no setup notification', async () => {
    const name = await openFolderWindow(runFolder('w08-web-no-probe'));
    await new Promise(resolve => setTimeout(resolve, 5_000));
    const {toasts} = await effectsOf(name);
    console.log(`w08-web-no-probe: ${JSON.stringify(toasts)}`);
    await closeWindow(name);
    deepStrictEqual(toasts, []);
  });

  it('F-6001 AC-19 (w08-web-connect-key): Connect to WSL by key binding fails with the browser message in one notification, and opens no window or picker', async () => {
    const restore = bindKeys([['j', 'remote-wsl.connect']]);
    try {
      const name = await openFolderWindow(runFolder('w08-web-connect-key'));
      const before = await effectsOf(name);
      await pressControlAlt(name, 'j');
      await new Promise(resolve => setTimeout(resolve, 3_000));
      const after = await effectsOf(name);
      console.log(`w08-web-connect-key: ${JSON.stringify({before, after})}`);
      await closeWindow(name);
      deepStrictEqual(
        {
          carrying: after.toasts.filter(toast => toast.includes(WEB_REJECTION))
            .length,
          others: after.toasts.filter(toast => !toast.includes(WEB_REJECTION)),
          windows: after.windows,
          picker: after.picker,
        },
        {carrying: 1, others: [], windows: before.windows, picker: false},
      );
    } finally {
      restore();
    }
  });

  it('F-6001 AC-32 (w08-web-keys): Open Folder in WSL and Connect in New Window by key binding open no window and write nothing, showing at most the browser message', async () => {
    const restore = bindKeys([
      ['n', 'remote-wsl.openFolder'],
      ['l', 'remote-wsl.connectInNewWindow'],
    ]);
    try {
      const name = await openFolderWindow(runFolder('w08-web-keys'));
      const before = await effectsOf(name);
      await pressControlAlt(name, 'n');
      await new Promise(resolve => setTimeout(resolve, 2_000));
      await pressControlAlt(name, 'l');
      await new Promise(resolve => setTimeout(resolve, 2_000));
      const after = await effectsOf(name);
      console.log(`w08-web-keys: ${JSON.stringify({before, after})}`);
      await closeWindow(name);
      deepStrictEqual(
        {
          windows: after.windows,
          settings: after.settings,
          picker: after.picker,
          others: after.toasts.filter(
            toast =>
              !toast.includes(WEB_REJECTION) &&
              !toast.endsWith('is not possible in the current context.'),
          ),
        },
        {
          windows: before.windows,
          settings: before.settings,
          picker: false,
          others: [],
        },
      );
    } finally {
      restore();
    }
  });
});
