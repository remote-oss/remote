import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {closeWindow, inWindow, waitFor} from '../windows/harness.ts';
import {
  answerDialog,
  rowContextMenu,
  rowDetails,
  rowMenuAction,
  viewRows,
} from '../windows/renderer.ts';
import {clearEarlierRows} from '../windows/folder-windows.ts';
import {
  rowsWhen,
  shown,
  stateOf,
  VIEW,
  viewed,
} from '../windows/dev-containers-view.ts';
import {
  composeFolder,
  dockerRun,
  openedCompose,
  removeComposeContainers,
  runningServicesOf,
  serviceContainerOf,
} from './compose-support.ts';

/** The parent row and its folder row share the folder's name, so a row is told by its place in the view. */
const PARENT = {index: 0, count: 2} as const;
const CHILD = {index: 1, count: 2} as const;

/** The two Open items of the folder row. */
const OPEN_ITEMS = [
  'Open in Container in Current Window',
  'Open in Container in New Window',
];

/** The name Docker gave container `containerId`. */
async function nameOf(containerId: string): Promise<string> {
  return (await dockerRun('inspect', '-f', '{{.Name}}', containerId)).replace(
    /^\//,
    '',
  );
}

/** The labels of the context menu of a row of `view` in window `name`, without the separators. */
async function menuOf(
  name: string,
  view: string,
  label: string,
  position?: {index: number; count: number},
): Promise<string[]> {
  return (await rowContextMenu(name, view, label, position)).filter(
    each => each !== '',
  );
}

describe('a Docker Compose dev container in the Dev Containers view (card containers-146)', function () {
  this.timeout(600_000);

  beforeEach(async () => {
    await clearEarlierRows();
    await inWindow('local', 'notifications.clearAll');
  });

  afterEach(async () => {
    await removeComposeContainers();
  });

  it('F-0901 AC-37 (c146-row): the row is labelled with the folder and has a folder row under it; its menus have the container actions only, from the window that holds it and from another; the Configuration row is the bare path, with no STR:S111 or S269 text', async () => {
    const label = 'c146-row';
    const folder = composeFolder({name: label, place: 'devcontainer'});
    const {name, containerId} = await openedCompose(folder);
    await inWindow(name, 'workbench.view.remote');
    await rowsWhen(
      name,
      rows => rows.filter(each => each.label === label).length === 2,
    );
    const ownParent = await menuOf(name, VIEW, label, PARENT);
    const ownChild = await menuOf(name, VIEW, label, CHILD);
    await inWindow(name, 'remote-containers.explorerDetailsRefresh');
    const configuration = (await viewRows(name, label))?.find(
      each => each.label === 'Configuration',
    );
    const details = (await rowDetails(name, label))?.find(
      each => each.label === 'Configuration',
    );
    await closeWindow(name);
    await viewed(label);
    const rows = (await rowDetails('local', VIEW))?.filter(
      each => each.label === label,
    );
    const parent = await menuOf('local', VIEW, label, PARENT);
    const child = await menuOf('local', VIEW, label, CHILD);
    deepStrictEqual(
      {
        ownParent,
        ownChild,
        configuration: [
          configuration?.description,
          details?.ariaLabel.includes('Dev Container configuration'),
          details?.ariaLabel.includes('Path:'),
        ],
        rows: rows?.map(each => [each.description, each.icon]),
        parent,
        child,
      },
      {
        ownParent: [
          'Show Details',
          'Inspect',
          'Show Container Log',
          'Reopen Folder Locally',
          'Rebuild Container',
        ],
        ownChild: ['Close Workspace', 'Reopen Folder Locally'],
        configuration: [
          path.join(folder, '.devcontainer', 'devcontainer.json'),
          false,
          false,
        ],
        rows: [
          [await nameOf(containerId), 'vm-running'],
          [`/workspaces/${label}`, 'folder'],
        ],
        parent: [
          'Show Details',
          'Inspect',
          'Show Container Log',
          'Stop Container',
          'Remove Container',
        ],
        child: OPEN_ITEMS,
      },
    );
  });

  it('F-0902 AC-31 (c146-removal): Stop Container and Remove Container act on the primary container alone; their dialogs name no other service, and the other service keeps running', async () => {
    const label = 'c146-removal';
    const folder = composeFolder({name: label, place: 'devcontainer'});
    const {name, project} = await openedCompose(folder);
    await closeWindow(name);
    await viewed(label);
    const before = await runningServicesOf(project);
    await rowMenuAction('local', VIEW, label, 'Stop Container', PARENT);
    const stopDialog = await shown('local');
    await answerDialog('local', 'Stop Container');
    await waitFor(
      'the primary container to stop',
      async () =>
        (await stateOf(await serviceContainerOf(project, 'app'))) === 'exited',
      60_000,
    );
    const afterStop = [
      await runningServicesOf(project),
      await stateOf(await serviceContainerOf(project, 'app')),
    ];
    await rowMenuAction('local', VIEW, label, 'Remove Container', PARENT);
    const removeDialog = await shown('local');
    await answerDialog('local', 'Remove');
    await waitFor(
      'the primary container to go',
      async () => (await serviceContainerOf(project, 'app')) === '',
      60_000,
    );
    const afterRemoval = [
      await runningServicesOf(project),
      await serviceContainerOf(project, 'app'),
    ];
    const texts = [stopDialog, removeDialog].map(
      dialog => `${dialog.message} ${dialog.details}`,
    );
    deepStrictEqual(
      {
        before,
        named: texts.map(text => text.includes('db')),
        afterStop,
        afterRemoval,
      },
      {
        before: ['app', 'db'],
        named: [false, false],
        afterStop: [['db'], 'exited'],
        afterRemoval: [['db'], ''],
      },
    );
  });
});
