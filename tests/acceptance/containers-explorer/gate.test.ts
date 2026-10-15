import {deepStrictEqual} from 'node:assert';
import {devContainerFolder, inWindow, waitFor} from '../windows/harness.ts';
import {
  notificationCentre,
  remoteExplorerOptions,
  selectRemote,
  viewRows,
} from '../windows/renderer.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';

/** The words core's error notification starts with when a view is created that no one registered. */
const NO_VIEW = 'No view is registered';

/** The window's rows of view `viewName`, once it has any. */
async function rowsOf(name: string, viewName: string): Promise<string[]> {
  let labels: string[] = [];
  await waitFor(
    `the rows of ${viewName} in window ${name}`,
    async () => {
      try {
        labels =
          (await viewRows(name, viewName))?.map(each => each.label) ?? [];
      } catch {
        return false;
      }
      return labels.length > 0;
    },
    60_000,
  );
  return labels;
}

describe('Dev Containers beside the Remote Explorer (card containers-30, coexistence row)', function () {
  this.timeout(300_000);

  it('F-0906 BR-3 (coexistence): the Switch Remote dropdown offers Dev Containers and Remotes (Tunnels/SSH), each shows its own view, and no error notification appears in either', async () => {
    const folder = devContainerFolder('view-both', {name: 'View Both'});
    const name = await openFolderWindow(folder);
    await inWindow(name, 'workbench.view.remote');
    const options = await remoteExplorerOptions(name);
    const shown: Record<string, string[]> = {};
    for (const option of options) {
      await selectRemote(name, option);
      shown[option] = await rowsOf(name, option);
    }
    const errors = (await notificationCentre(name)).filter(
      text => text.includes(NO_VIEW) || text.includes('Error'),
    );
    deepStrictEqual(
      {options: [...options].sort(), views: Object.keys(shown).sort(), errors},
      {
        options: ['Dev Containers', 'Remotes (Tunnels/SSH)'],
        views: ['Dev Containers', 'Remotes (Tunnels/SSH)'],
        errors: [],
      },
    );
  });
});
