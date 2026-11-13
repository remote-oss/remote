import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, commandsOf, variable} from '../windows/harness.ts';
import {
  openFolderWindow,
  openMemoryWindow,
  openWorkspaceWindow,
} from '../windows/folder-windows.ts';
import {
  quickPickOf,
  pressControlAlt,
  pressEscape,
} from '../windows/renderer.ts';
import {paletteItems, runFromPalette} from '../windows/palette.ts';
import {indicatorMenu} from '../windows/authoring-support.ts';
import {effectsOf, runFolder, wslPaletteEntries} from './wsl-support.ts';

/** The commands a key binding invokes on Linux, each on Ctrl+Alt and its letter, and one id nothing registers. */
const BOUND = [
  ['j', 'remote-wsl.connect'],
  ['k', 'remote-wsl.connectUsingDistro'],
  ['l', 'remote-wsl.connectInNewWindow'],
  ['m', 'remote-wsl.connectUsingDistroInNewWindow'],
  ['n', 'remote-wsl.openFolder'],
  ['o', 'remote-wsl.newWindow'],
  ['p', 'remote-wsl.newWindowForDistro'],
] as const;
const UNKNOWN_KEY = 'u';
const UNKNOWN_COMMAND = 'remote-wsl.noSuchCommand';

/** Writes the key bindings into the launch's profile; the function it returns puts the file back. */
function bindKeys(): () => void {
  const file = path.join(
    variable('HARNESS_USER_DATA'),
    'User/keybindings.json',
  );
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  writeFileSync(
    file,
    JSON.stringify([
      ...BOUND.map(([letter, command]) => ({
        key: `ctrl+alt+${letter}`,
        command,
      })),
      {key: `ctrl+alt+${UNKNOWN_KEY}`, command: UNKNOWN_COMMAND},
    ]),
  );
  return () => {
    if (before === undefined) {
      rmSync(file, {force: true});
    } else {
      writeFileSync(file, before);
    }
  };
}

describe('WSL on a Linux desktop (card #2365)', function () {
  this.timeout(300_000);

  it('F-6001 AC-12 (w08-linux-surface): in a Linux folder window the extension is active, the palette lists only Reopen Folder in WSL and Show Log, and neither the remote indicator nor a view shows WSL', async () => {
    const name = await openFolderWindow(runFolder('w08-linux-surface'));
    const registered = await commandsOf(name, 'remote-wsl.');
    const palette = await wslPaletteEntries(name);
    const views = (await paletteItems(name, 'WSL Targets')).filter(item =>
      item.includes('WSL Targets'),
    );
    const menu = await indicatorMenu(name);
    console.log(
      `w08-linux-surface: ${JSON.stringify({registered: registered.length, palette, views, menu})}`,
    );
    await closeWindow(name);
    deepStrictEqual(
      {
        active: registered.length > 0,
        palette,
        views,
        menu: menu.filter(item => item.includes('WSL')),
      },
      {
        active: true,
        palette: ['WSL: Reopen Folder in WSL', 'WSL: Show Log'],
        views: [],
        menu: [],
      },
    );
  });

  it('F-6001 AC-13 (w08-linux-walkthrough): Welcome: Open Walkthrough... offers no WSL walkthrough on Linux', async () => {
    const name = await openFolderWindow(runFolder('w08-linux-walkthrough'));
    await runFromPalette(name, 'Welcome: Open Walkthrough...');
    const offered = (await quickPickOf(name))?.items ?? [];
    await pressEscape(name);
    console.log(`w08-linux-walkthrough: ${JSON.stringify(offered)}`);
    await closeWindow(name);
    deepStrictEqual(
      offered.filter(item => item.includes('WSL')),
      [],
    );
  });

  it('F-6001 AC-14 (w08-linux-reopen): Reopen Folder in WSL on Linux opens nothing, writes nothing and leaves the window usable', async () => {
    const name = await openFolderWindow(runFolder('w08-linux-reopen'));
    const before = await effectsOf(name);
    await runFromPalette(name, 'WSL: Reopen Folder in WSL');
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const after = await effectsOf(name);
    const usable = (await commandsOf(name, 'remote-wsl.')).length > 0;
    console.log(`w08-linux-reopen: ${JSON.stringify({before, after})}`);
    await closeWindow(name);
    deepStrictEqual({after, usable}, {after: before, usable: true});
  });

  it('F-6001 AC-15 (w08-linux-keys): each connect, open-folder and new-window command invoked by key binding on Linux reports no unknown command and changes nothing, where an unbound id is reported', async () => {
    const restore = bindKeys();
    try {
      const name = await openFolderWindow(runFolder('w08-linux-keys'));
      const before = await effectsOf(name);
      for (const [letter] of BOUND) {
        await pressControlAlt(name, letter);
        await new Promise(resolve => setTimeout(resolve, 1_500));
      }
      const after = await effectsOf(name);
      await pressControlAlt(name, UNKNOWN_KEY);
      await new Promise(resolve => setTimeout(resolve, 1_500));
      const control = (await effectsOf(name)).toasts;
      console.log(
        `w08-linux-keys: ${JSON.stringify({before, after, control})}`,
      );
      await closeWindow(name);
      deepStrictEqual(
        {
          after,
          controlReported: control.some(toast =>
            toast.includes(UNKNOWN_COMMAND),
          ),
        },
        {after: before, controlReported: true},
      );
    } finally {
      restore();
    }
  });

  it('F-6001 AC-16 (w08-linux-virtual): in a purely virtual workspace the extension is active, and the palette has Show Log but not Reopen Folder in WSL', async () => {
    const name = await openMemoryWindow();
    const registered = await commandsOf(name, 'remote-wsl.');
    const palette = await wslPaletteEntries(name);
    console.log(`w08-linux-virtual: ${JSON.stringify(palette)}`);
    await closeWindow(name);
    deepStrictEqual(
      {active: registered.length > 0, palette},
      {active: true, palette: ['WSL: Show Log']},
    );
  });

  it('F-6001 AC-17 (w08-linux-mixed): in a workspace of a local and a virtual folder the palette lists Reopen Folder in WSL', async () => {
    const folder = runFolder('w08-linux-mixed', {
      'mixed.code-workspace': JSON.stringify({
        folders: [{path: '.'}, {uri: 'memfs:/'}],
      }),
    });
    const name = await openWorkspaceWindow(
      path.join(folder, 'mixed.code-workspace'),
    );
    const palette = await wslPaletteEntries(name);
    console.log(`w08-linux-mixed: ${JSON.stringify(palette)}`);
    await closeWindow(name);
    deepStrictEqual(palette.includes('WSL: Reopen Folder in WSL'), true);
  });
});
