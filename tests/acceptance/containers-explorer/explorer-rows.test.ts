import {deepStrictEqual} from 'node:assert';
import {devContainerFolder, inWindow, waitFor} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {remoteExplorerSections, selectedRemote} from '../windows/renderer.ts';

describe('the Remote Explorer beside Dev Containers (card explorer-09)', function () {
  this.timeout(300_000);

  // This row must run before any row that selects an option of the Switch Remote dropdown: a selection stores
  // `remote.explorerType` in the run's profile, and with a stored type the explorer follows it. This file sorts before
  // gate.test.ts, and its own rows that select options come after this one.
  it('F-5101 AC-2 (sections-first): with no target type stored, the sections of the Remote Explorer start with Remotes (Tunnels/SSH), before Dev Containers and Help and feedback', async () => {
    const folder = devContainerFolder('x09-sections', {name: 'Sections'});
    const name = await openFolderWindow(folder);
    await inWindow(name, 'workbench.view.remote');
    let sections: string[] = [];
    await waitFor(
      'the sections of the Remote Explorer',
      async () => {
        sections = await remoteExplorerSections(name).catch(() => []);
        return sections.includes('Help and feedback');
      },
      60_000,
    );
    deepStrictEqual(
      {sections, selected: await selectedRemote(name)},
      {
        sections: [
          'Remotes (Tunnels/SSH)',
          'Dev Containers',
          'Help and feedback',
        ],
        selected: 'Dev Containers',
      },
    );
  });
});
