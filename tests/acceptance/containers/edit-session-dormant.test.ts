import {deepStrictEqual} from 'node:assert';
import {commandsOf, containersLog} from '../windows/harness.ts';
import {
  ADD_ITEM,
  indicatorMenu,
  withWindow,
} from '../windows/authoring-support.ts';
import {
  noticesOnceSettled,
  paletteRows,
  rememberPage,
} from '../windows/renderer.ts';

/** What the rows of the two commands of F-0707 say; the entry that clones a repository in a container volume is another feature's and is offered. */
const CONTINUE_ROW = 'Continue Working in Container Volume';

/** The two commands of F-0707, which are registered and offered nowhere. */
const COMMANDS = [
  'remote-containers.openRepositoryFromGitWithEditSession',
  'remote-containers.openRepositoryFromRemoteHubWithEditSession',
];

describe('the edit-session entries are dormant (card containers-156)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  it('F-0707 AC-1, AC-3, AC-6, AC-8 (c156-dormant): the palette and the indicator menu are filled with this extension’s own entries, and yet the two commands are registered and found nowhere; no row says Continue Working in Container Volume in the palette or the remote indicator menu, and the window shows no notification and writes no log line about them', async () => {
    await withWindow('c156-dormant', {}, async window => {
      const before = containersLog().length;
      const indicator = await indicatorMenu(window);
      const registered = (
        await commandsOf(window, 'remote-containers.openRepositoryFrom')
      ).sort();
      const palette = await paletteRows(
        window,
        'Dev Containers: Clone Repository in a Container Volume',
      );
      const continuing = await paletteRows(window, CONTINUE_ROW);
      const ownPalette = await paletteRows(
        window,
        'Add Dev Container Configuration',
      );
      deepStrictEqual(
        {
          filled: [
            ownPalette.includes(`Dev Containers: ${ADD_ITEM}`),
            indicator.includes(ADD_ITEM),
          ],
          registered,
          palette: palette.filter(entry => entry.includes(CONTINUE_ROW)),
          continuing: continuing.filter(entry => entry.includes(CONTINUE_ROW)),
          indicator: indicator.filter(entry => entry.includes(CONTINUE_ROW)),
          notices: await noticesOnceSettled(window),
          lines: containersLog()
            .slice(before)
            .filter(text => /edit.?session|Container Volume/i.test(text)),
        },
        {
          filled: [true, true],
          registered: COMMANDS,
          palette: [],
          continuing: [],
          indicator: [],
          notices: [],
          lines: [],
        },
      );
    });
  });
});
