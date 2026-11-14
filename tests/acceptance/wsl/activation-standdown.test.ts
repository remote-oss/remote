import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  commandsOf,
  extensionPresent,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {notifications} from '../windows/renderer.ts';
import {runFolder, wslPaletteEntries} from './wsl-support.ts';

/** The coexistence warning WSL shows beside the other WSL extension. */
const STAND_DOWN_WARNING =
  'WSL stays inactive in this window because another extension that connects to WSL distros is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';

describe('WSL stands down beside the other WSL extension (card #2365)', function () {
  this.timeout(300_000);

  it('F-6001 AC-34 (w08-standdown-part): with the other extension enabled, WSL warns once, registers no command, and its gated entries leave the palette', async () => {
    const name = await openFolderWindow(runFolder('w08-standdown'));
    let shown: string[] = [];
    await waitFor(
      `the coexistence warning in window ${name}`,
      async () => {
        shown = await notifications(name);
        return shown.includes(STAND_DOWN_WARNING);
      },
      30_000,
    );
    const facts = {
      standIn: await extensionPresent('local', 'ms-vscode-remote.remote-wsl'),
      warnings: shown.filter(text => text === STAND_DOWN_WARNING).length,
      registered: await commandsOf(name, 'remote-wsl.'),
      palette: await wslPaletteEntries(name),
    };
    console.log(`w08-standdown: ${JSON.stringify({facts, shown})}`);
    await closeWindow(name);
    deepStrictEqual(facts, {
      standIn: true,
      warnings: 1,
      registered: [],
      palette: [],
    });
  });
});
