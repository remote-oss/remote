/**
 * @fileoverview The dialog of a saved workspace with a virtual folder, for the commands that exist (card #2724, F-0801
 * AC-31, F-0404 AC-31): STR:S363 filled with STR:S408 for the first virtual folder, whichever command is run and
 * whichever order the folders are in. The clause of F-0812's "Open Container Configuration File" waits for its card (#2094).
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {closeWindow} from '../windows/harness.ts';
import {openWorkspaceWindow} from '../windows/folder-windows.ts';
import {
  answerDialog,
  pressEscape,
  quickPickFacts,
  rememberPage,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  chooseWorkspace,
  folderWith,
  startCommand,
  treeOf,
  workspaceFile,
} from '../windows/authoring-support.ts';

const ADD_FILES = 'remote-containers.createDevContainerFile';

const CONFIGURE_FEATURES = 'remote-containers.configureContainerFeatures';

const REOPEN = 'remote-containers.reopenInContainer';

/** The detail of the dialog that names the virtual folder of a saved workspace: S363 filled with S408. */
const VIRTUAL_PROBLEM =
  "The workspace could fail to open in a container: Workspace contains folder 'memfs:/' not on the local file system.";

describe('a saved workspace with a virtual folder and no configuration (card #2724)', function () {
  this.timeout(600_000);

  /**
   * Opens a saved workspace of a local folder and a virtual root, the virtual one first when `virtualFirst`, and runs
   * `body` over the window and the folder.
   */
  async function inWorkspace(
    label: string,
    virtualFirst: boolean,
    body: (window: string, folder: string, file: string) => Promise<void>,
  ): Promise<void> {
    const folder = folderWith(label, {'README.md': 'x\n'});
    const entries = [{path: path.basename(folder)}, {uri: 'memfs:/'}];
    const file = workspaceFile(
      label,
      virtualFirst ? entries.toReversed() : entries,
    );
    const window = await openWorkspaceWindow(file);
    await rememberPage(window);
    try {
      await body(window, folder, file);
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  }

  /** What the dialog of `command` shows once `before` modals are answered with their first button; it is then Cancelled. */
  async function cancelledProblem(
    window: string,
    command: string,
    firstButton?: string,
  ): Promise<{detail: string; buttons: string[]}> {
    await startCommand(window, command);
    if (firstButton !== undefined) {
      await waitForDialog(window, 60_000);
      await answerDialog(window, firstButton);
    }
    const problem = await waitForDialog(window, 60_000);
    await answerDialog(window, 'Cancel');
    return {detail: problem.details, buttons: problem.buttons};
  }

  it('F-0801 AC-31 (c2724-add-virtual-first-part): Add Dev Container Configuration Files... in a workspace whose first folder is virtual asks with S363 filled with S408, Cancel writes nothing, and Continue goes on to the location pick and the template pick for the workspace file’s folder', async () => {
    await inWorkspace('c2724-add', true, async (window, folder, file) => {
      const before = treeOf(folder);
      const cancelled = await cancelledProblem(window, ADD_FILES);
      await startCommand(window, ADD_FILES);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Continue');
      await chooseWorkspace(window);
      const template = (await quickPickFacts(window))?.placeholder;
      await pressEscape(window);
      deepStrictEqual(
        {
          cancelled,
          template,
          folder: treeOf(folder),
          beside: existsSync(path.join(path.dirname(file), '.devcontainer')),
        },
        {
          cancelled: {
            detail: VIRTUAL_PROBLEM,
            buttons: ['Cancel', 'Continue'],
          },
          template:
            'Select a container configuration template or enter a custom template id',
          folder: before,
          beside: false,
        },
      );
    });
  });

  it('F-0404 AC-31 (c2724-commands-virtual-first-part): Add Files..., Reopen in Container and the Add Dev Container Configuration Files command show the S408 text for the first virtual folder, and with the local folder first the same text', async () => {
    const seen: Record<string, unknown> = {};
    for (const virtualFirst of [true, false]) {
      await inWorkspace(
        `c2724-all-${virtualFirst ? 'virtual' : 'local'}`,
        virtualFirst,
        async window => {
          seen[`${virtualFirst ? 'virtual' : 'local'} first`] = [
            await cancelledProblem(window, ADD_FILES),
            await cancelledProblem(window, CONFIGURE_FEATURES, 'Add Files...'),
            await cancelledProblem(window, REOPEN),
          ];
        },
      );
    }
    const problem = {detail: VIRTUAL_PROBLEM, buttons: ['Cancel', 'Continue']};
    deepStrictEqual(seen, {
      'virtual first': [problem, problem, problem],
      'local first': [problem, problem, problem],
    });
  });
});
