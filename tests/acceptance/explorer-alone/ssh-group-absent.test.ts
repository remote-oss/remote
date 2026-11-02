/**
 * @fileoverview The SSH group's commands when Remote - SSH is absent (card coverage-102, #1809, part 2): the view has
 * no SSH row, host row or group action, and the keys of `remote-explorer.configureSsh` and `remote-explorer.add` write
 * no file, open no window and show at most a non-modal message.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {bindKeys} from '../windows/explorer-folders.ts';
import {inWindow, windowNames} from '../windows/harness.ts';
import {
  dialogOf,
  editorTabs,
  paletteRows,
  pressControlAlt,
  pressEscape,
  quickPickFacts,
  viewRows,
} from '../windows/renderer.ts';

const LOCAL = 'local';
const VIEW = 'Remotes (Tunnels/SSH)';

/** The user file Remote - SSH would write, and its text now, if there is one. */
function userFileText(): string | undefined {
  const file = path.join(homedir(), '.ssh', 'config');
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

describe('the SSH group commands with Remote - SSH absent (card coverage-102, part 2)', function () {
  this.timeout(120_000);

  it('F-5102 AC-27, AC-28, F-5002 AC-12 (absent): the view has no SSH row, no host row and no group action, and the keys of configureSsh and add write no file, open no window and show no dialog, and the window stays usable', async () => {
    const restore = await bindKeys([
      {key: 'ctrl+alt+j', command: 'remote-explorer.configureSsh'},
      {key: 'ctrl+alt+k', command: 'remote-explorer.add'},
      {key: 'ctrl+alt+l', command: 'workbench.action.showCommands'},
    ]);
    try {
      await inWindow(LOCAL, 'workbench.view.remote');
      const drawn = await viewRows(LOCAL, VIEW);
      const rows = drawn ?? [];
      const windows = windowNames();
      const file = userFileText();
      const tabs = await editorTabs(LOCAL);
      await pressControlAlt(LOCAL, 'l');
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const keysReach = (await quickPickFacts(LOCAL)) !== undefined;
      await pressEscape(LOCAL);
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const after: unknown[] = [];
      for (const key of ['j', 'k']) {
        await pressControlAlt(LOCAL, key);
        await new Promise(resolve => setTimeout(resolve, 3_000));
        await pressEscape(LOCAL);
        await new Promise(resolve => setTimeout(resolve, 1_000));
        after.push({
          file: userFileText(),
          windows: windowNames(),
          tabs: await editorTabs(LOCAL),
          dialog: await dialogOf(LOCAL),
          pick: await quickPickFacts(LOCAL),
          usable: (await paletteRows(LOCAL, 'Focus on Remotes')).length > 0,
        });
      }
      const state = {
        file,
        windows,
        tabs,
        dialog: undefined,
        pick: undefined,
        usable: true,
      };
      deepStrictEqual([keysReach, rows, after], [true, [], [state, state]]);
    } finally {
      restore();
    }
  });
});
