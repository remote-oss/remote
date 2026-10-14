import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  commandsOf,
  extensionPresent,
  inWindow,
  reloadWindow,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {notifications} from '../windows/renderer.ts';

/** The window the rows open: a `dev-container` authority whose payload is the hex of `{}`, which only activates the package. */
const WINDOW = 'gate-standdown';

/** Dev Containers' coexistence warning, as containers-01 shows it. */
const STAND_DOWN_WARNING =
  'Dev Containers stays inactive in this window because another Dev Containers extension is enabled. Both use the same commands, settings and remote connections. Disable one of the two extensions and reload the window.';

describe('Dev Containers stands down beside the other extension (card containers-09, gate row 9)', function () {
  this.timeout(180000);

  before(async () => {
    await inWindow(
      'local',
      'acceptance.agent.openWindow',
      `vscode-remote://dev-container+7b7d/workspaces/${WINDOW}`,
    );
    await waitFor(
      `window ${WINDOW} to activate its agent`,
      () => windowEvents(WINDOW).some(each => each.event === 'activated'),
      60_000,
    );
  });

  it('containers-09: the editor has the stand-in that carries the other extension’s id', async () => {
    strictEqual(
      await extensionPresent('local', 'ms-vscode-remote.remote-containers'),
      true,
    );
  });

  it('F-0101 AC-18 (first-half): the window shows the coexistence warning once and registers no command of Dev Containers', async () => {
    let shown: string[] = [];
    await waitFor(
      `the coexistence warning in window ${WINDOW}`,
      async () => {
        shown = await notifications(WINDOW);
        return shown.includes(STAND_DOWN_WARNING);
      },
      30_000,
    );
    deepStrictEqual(
      [
        shown.filter(text => text === STAND_DOWN_WARNING).length,
        await commandsOf(WINDOW, 'remote-containers.'),
      ],
      [1, []],
    );
  });
  it('F-0101 AC-18 (reappearance): dismissed, the warning shows again at the next activation, once, and the commands stay unregistered', async () => {
    await inWindow(WINDOW, 'notifications.clearAll');
    await reloadWindow(WINDOW);
    let shown: string[] = [];
    await waitFor(
      `the coexistence warning again in window ${WINDOW}`,
      async () => {
        shown = await notifications(WINDOW);
        return shown.includes(STAND_DOWN_WARNING);
      },
      30_000,
    );
    deepStrictEqual(
      [
        shown.filter(text => text === STAND_DOWN_WARNING).length,
        await commandsOf(WINDOW, 'remote-containers.'),
      ],
      [1, []],
    );
  });
});
