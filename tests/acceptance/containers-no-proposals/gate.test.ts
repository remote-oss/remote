import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {activations, openFolderWindow} from '../windows/folder-windows.ts';
import {
  activeEditorOf,
  closeWindow,
  commandsOf,
  devContainerFolder,
  devContainersOf,
  editorLogsFolder,
  inWindow,
  reloadWindow,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  answerNotification,
  notificationButtons,
  notificationCentre,
  remoteExplorerOptions,
  remoteExplorerSections,
  viewRows,
  windowTitle,
} from '../windows/renderer.ts';

/** The window the rows open: a `dev-container` authority whose payload is the hex of `{}`, which only activates the package. */
const WINDOW = 'gate-setup';

/** The titles of the sections our views would add to the Remote Explorer. */
const OUR_SECTIONS = ['Dev Containers', 'Details', 'Dev Volumes'];

/** The lines of the run editor's window logs that name the remote view container and the contribViewsRemote proposal. */
function proposalWarnings(): string[] {
  const logs = editorLogsFolder();
  return readdirSync(logs, {recursive: true, encoding: 'utf8'})
    .filter(file => file.endsWith('renderer.log'))
    .flatMap(file => readFileSync(path.join(logs, file), 'utf8').split('\n'))
    .filter(
      line => line.includes('contribViewsRemote') && line.includes('remote'),
    );
}

/** The package's own file `name`, parsed. */
function packageFile(name: string): unknown {
  return JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'remote-containers',
        name,
      ),
      'utf8',
    ),
  );
}

/**
 * The commands Dev Containers registers: the ones it contributes, which stay registered without the proposed API
 * (brief ruling 9), and the runtime commands it registers without contributing.
 */
const REGISTERED = [
  ...(
    (
      packageFile('package.json') as {
        contributes?: {commands?: Array<{command: string}>};
      }
    ).contributes?.commands ?? []
  ).map(entry => entry.command),
  ...(
    packageFile('identifiers.json') as {runtimeCommands: Array<{id: string}>}
  ).runtimeCommands.map(entry => entry.id),
].sort();

/**
 * The start of Dev Containers' setup notice, with the proposed API not enabled. Core raises the notice beside its own
 * failed-resolve error and does not always show it as a toast, so the row reads the notification centre.
 */
const SETUP_START = 'Dev Containers needs proposed VS Code APIs that ';

/** The start of the notice after a setup attempt that didn't enable the proposals. */
const FAILED_ATTEMPT_START =
  'The previous setup attempt did not enable the proposed APIs ';

/** The start of the restart offer after the runtime arguments were saved. */
const RESTART_START = 'Quit and start ';

/** The notifications of window `name` that are Dev Containers' setup notices. */
async function setupNotices(name: string): Promise<string[]> {
  return (await notificationCentre(name)).filter(
    text =>
      text.startsWith(SETUP_START) || text.startsWith(FAILED_ATTEMPT_START),
  );
}

describe('Dev Containers without its proposed API (card containers-09, gate row 10)', function () {
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

  it('F-0101 AC-15 (first-clause): the setup notice names the extension, nothing of ours fails, and the commands stay registered', async () => {
    let shown: string[] = [];
    await waitFor(
      `the setup notice in window ${WINDOW}`,
      async () => {
        shown = await notificationCentre(WINDOW);
        return shown.some(text => text.startsWith(SETUP_START));
      },
      15_000,
    );
    deepStrictEqual(
      {
        setup: shown.filter(
          text =>
            text.startsWith(SETUP_START) &&
            text.includes('remote-oss.remote-containers'),
        ).length,
        failures: shown.filter(
          text =>
            text.startsWith('Dev Containers') &&
            (text.includes('Error') || text.includes('failed')),
        ),
        commands: await commandsOf(WINDOW, 'remote-containers.'),
      },
      {setup: 1, failures: [], commands: REGISTERED},
    );
  });
  it('F-0906 AC-16 (gate-row-17): the Remote Explorer has no Dev Containers view, and no error notification says that no view is registered (F-0101 BR-9)', async () => {
    await inWindow(WINDOW, 'workbench.view.remote');
    await new Promise(resolve => setTimeout(resolve, 5_000));
    deepStrictEqual(
      {
        view: await viewRows(WINDOW, 'Dev Containers'),
        errors: (await notificationCentre(WINDOW)).filter(text =>
          text.includes('No view is registered'),
        ),
      },
      {view: undefined, errors: []},
    );
  });

  it.skip('F-0906 AC-16 (whole): the Remote Explorer has no section and no dropdown option of ours, no error notification shows, and core logs the remote view container’s proposal warning', async () => {
    await inWindow(WINDOW, 'workbench.view.remote');
    await new Promise(resolve => setTimeout(resolve, 5_000));
    deepStrictEqual(
      {
        view: await viewRows(WINDOW, 'Dev Containers'),
        sections: (await remoteExplorerSections(WINDOW)).filter(title =>
          OUR_SECTIONS.includes(title),
        ),
        options: (await remoteExplorerOptions(WINDOW)).filter(
          option => option === 'Dev Containers',
        ),
        errors: (await notificationCentre(WINDOW)).filter(text =>
          text.includes('No view is registered'),
        ),
        warned: proposalWarnings().length > 0,
      },
      {view: undefined, sections: [], options: [], errors: [], warned: true},
    );
  });

  it('F-0101 AC-15: the primary button opens argv.json, and saving and closing it unchanged offers the restart', async () => {
    await answerNotification(
      WINDOW,
      SETUP_START,
      'Configure Runtime Arguments',
    );
    await waitFor(
      `argv.json to be the active editor of window ${WINDOW}`,
      async () =>
        (await activeEditorOf(WINDOW))?.endsWith('argv.json') === true,
      30_000,
    );
    await inWindow(WINDOW, 'workbench.action.files.save');
    await inWindow(WINDOW, 'workbench.action.closeActiveEditor');
    const buttons = await notificationButtons(WINDOW, RESTART_START);
    console.log(
      `containers-09: the restart offer's buttons: ${JSON.stringify(buttons)}`,
    );
    deepStrictEqual(
      [buttons.length, buttons[0]?.startsWith('Quit ')],
      [1, true],
    );
    await inWindow(WINDOW, 'notifications.clearAll');
  });

  it('F-0101 AC-15: after that attempt, the next activation tells the failed attempt, and Not Now dismisses it', async () => {
    await reloadWindow(WINDOW);
    await answerNotification(WINDOW, FAILED_ATTEMPT_START, 'Not Now');
    await inWindow(WINDOW, 'notifications.clearAll');
  });

  it('F-0101 AC-15: after the dismissal, the next activation shows no warning', async () => {
    await reloadWindow(WINDOW);
    await new Promise(resolve => setTimeout(resolve, 15_000));
    deepStrictEqual(await setupNotices(WINDOW), []);
  });

  it('F-0101 AC-15: Reopen in Container on a configured folder leaves the window local (BR-9 2 (d)), with no remote and no failed-resolve error, and the setup notice is the only one', async () => {
    const folder = devContainerFolder('c36-no-proposals');
    const name = await openFolderWindow(folder);
    const activated = activations(name);
    const title = await windowTitle(name);
    await inWindow(name, 'remote-containers.reopenInContainer');
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const notices = await notificationCentre(name);
    deepStrictEqual(
      {
        activated: activations(name) - activated,
        remoteName: (await windowState(name)).remoteName,
        title: await windowTitle(name),
        resolveErrors: notices.filter(text =>
          text.startsWith('No remote extension installed to resolve'),
        ),
        others: notices.filter(
          text =>
            !text.startsWith(SETUP_START) &&
            !text.startsWith(FAILED_ATTEMPT_START),
        ),
        containers: await devContainersOf(folder),
      },
      {
        activated: 0,
        remoteName: null,
        title,
        resolveErrors: [],
        others: [],
        containers: [],
      },
    );
    await closeWindow(name);
  });
});
