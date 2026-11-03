import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  runLabelArguments,
  startInWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  openWorkspaceWindow,
  removeContainers,
} from '../windows/folder-windows.ts';
import {
  answerDialog,
  answerNotification,
  notificationButtons,
  notificationCentre,
  notificationLinks,
  quickPickFacts,
  quickPickRows,
  toastFacts,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {closeScreen, rowsOf} from '../windows/authoring-support.ts';

const execFileAsync = promisify(execFile);

/** The workspace variant of the reopen notification, the link as its words (F-0402 S427 with S405). */
const WORKSPACE_NOTICE =
  'Workspace contains a Dev Container configuration file. Reopen workspace to develop in a container (learn more).';

const WORKSPACE_NOTICE_START =
  'Workspace contains a Dev Container configuration file.';

/** The follow-up of Don't Show Again... in a workspace window (S152). */
const WORKSPACE_FOLLOW_UP =
  "Don't show again for the current workspace or for any workspace?";

/** The page the notification's link opens. */
const INTRODUCTION =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md';

/** The command that forgets every Don't Show Again choice, so that a row leaves none behind. */
const NOTIFICATION_RESET =
  'remote-containers.showReopenInContainerNotificationReset';

/** The modal an untitled multi-root workspace gets (S415). */
const SAVE_FIRST =
  'You need to first save your workspace in a folder containing all its workspace folders.';

/** The frame and the rows of the pick that asks where to create the configuration. */
const WHERE = {
  title: 'Add Dev Container Configuration Files',
  rows: [
    [
      'Add configuration to workspace',
      '',
      'This allows you to share the configuration with others via source control',
      true,
    ],
    [
      'Add configuration to user data folder',
      '',
      'This avoids having outgoing changes in your workspace folder',
      false,
    ],
  ],
};

/** A saved workspace: the folder that holds its file, and the file. */
interface SavedWorkspace {
  folder: string;
  file: string;
}

/**
 * Makes `<run>/<label>/`, empty first, with the roots `roots` (each a folder of its own, with a configuration named
 * after it when its value is true) and the workspace file `<label>.code-workspace` listing them, and gives both.
 */
function workspaceWith(
  label: string,
  roots: Readonly<Record<string, boolean>>,
): SavedWorkspace {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  for (const [root, configured] of Object.entries(roots)) {
    if (configured) {
      devContainerFolder(path.join(label, root), {name: root});
    } else {
      mkdirSync(path.join(folder, root));
    }
  }
  const file = path.join(folder, `${label}.code-workspace`);
  writeFileSync(
    file,
    JSON.stringify({folders: Object.keys(roots).map(root => ({path: root}))}),
  );
  return {folder, file};
}

/** Writes a configuration named `name` at `relative` under `folder`, as the run's dev containers are made. */
function configurationAt(folder: string, relative: string, name: string): void {
  const file = path.join(folder, relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(
    file,
    JSON.stringify({
      image: variable('HARNESS_DEVCONTAINER_IMAGE'),
      runArgs: runLabelArguments(),
      name,
    }),
  );
}

/** Polls until window `name` shows the workspace notification, for up to 20 s. */
function workspaceNoticeShown(name: string): Promise<void> {
  return waitFor(
    `the workspace notification in window ${name}`,
    async () =>
      (await notificationCentre(name)).some(text =>
        text.startsWith(WORKSPACE_NOTICE_START),
      ),
    20_000,
  );
}

/** Whether window `name` shows the workspace notification within 10 s of opening. */
async function showsWorkspaceNotice(name: string): Promise<boolean> {
  return workspaceNoticeShown(name).then(
    () => true,
    () => false,
  );
}

/** The bind mounts of container `containerId`: their sources. */
async function bindSources(containerId: string): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{range .Mounts}}{{if eq .Type "bind"}}{{println .Source}}{{end}}{{end}}',
    containerId,
  ]);
  return stdout.split('\n').filter(line => line !== '');
}

describe('multi-root workspaces (card coverage-104)', function () {
  this.timeout(900_000);

  it('F-0301 AC-22 (c104-roots): a saved workspace whose roots each carry a configuration, with none beside its file, gives the wizard, not a picker or a connection', async () => {
    const workspace = workspaceWith('c104-roots', {
      'c104-roots-a': true,
      'c104-roots-b': true,
    });
    const window = await openWorkspaceWindow(workspace.file);
    try {
      await startInWindow(window, 'remote-containers.reopenInContainer');
      await waitForQuickPick(window, 180_000);
      const seen = [
        (await quickPickFacts(window))?.title,
        await rowsOf(window),
      ];
      await closeScreen(window);
      deepStrictEqual(
        [
          ...seen,
          (await windowState(window)).remoteName,
          await devContainersOf(path.join(workspace.folder, 'c104-roots-a')),
          await devContainersOf(workspace.folder),
        ],
        [WHERE.title, WHERE.rows, null, [], []],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0301 AC-50, F-0101 AC-3b (c104-notice): a workspace of two configured roots, and one of a configured root beside a plain one, each show the workspace notification with its link, severity, source and buttons', async () => {
    const seen: unknown[] = [];
    for (const [label, roots] of [
      [
        'c104-notice-both',
        {'c104-notice-both-a': true, 'c104-notice-both-b': true},
      ],
      [
        'c104-notice-one',
        {'c104-notice-one-a': true, 'c104-notice-one-b': false},
      ],
    ] as const) {
      const window = await openWorkspaceWindow(
        workspaceWith(label, roots).file,
      );
      try {
        await workspaceNoticeShown(window);
        seen.push([
          (await notificationCentre(window)).filter(text =>
            text.startsWith(WORKSPACE_NOTICE_START),
          ),
          await notificationLinks(window, WORKSPACE_NOTICE_START),
          await notificationButtons(window, WORKSPACE_NOTICE_START),
          (await toastFacts(window))
            .filter(each => each.message.startsWith(WORKSPACE_NOTICE_START))
            .map(each => [
              each.source,
              each.severity,
              each.buttons.map(button => button.primary),
            ]),
        ]);
      } finally {
        await closeWindow(window).catch(() => undefined);
      }
    }
    const shown = [
      [WORKSPACE_NOTICE],
      [{text: 'learn more', href: INTRODUCTION}],
      ['Reopen in Container', "Don't Show Again..."],
      [['Source: Dev Containers', 'info', [true, false]]],
    ];
    deepStrictEqual(seen, [shown, shown]);
  });

  it('F-0402 AC-7, F-0301 AC-50 (c104-current): Don’t Show Again... asks with Any Workspace and Current Workspace, and Current Workspace keeps the notification away from that workspace only', async () => {
    const kept = workspaceWith('c104-current', {'c104-current-a': true});
    const other = workspaceWith('c104-other', {'c104-other-a': true});
    try {
      const window = await openWorkspaceWindow(kept.file);
      await workspaceNoticeShown(window);
      await answerNotification(
        window,
        WORKSPACE_NOTICE_START,
        "Don't Show Again...",
      );
      const followUp = [
        (await notificationCentre(window)).includes(WORKSPACE_FOLLOW_UP),
        await notificationButtons(window, WORKSPACE_FOLLOW_UP),
      ];
      await answerNotification(
        window,
        WORKSPACE_FOLLOW_UP,
        'Current Workspace',
      );
      await closeWindow(window);
      const again = await openWorkspaceWindow(kept.file);
      const keptShows = await showsWorkspaceNotice(again);
      await closeWindow(again);
      const elsewhere = await openWorkspaceWindow(other.file);
      const otherShows = await showsWorkspaceNotice(elsewhere);
      await closeWindow(elsewhere);
      deepStrictEqual(
        [followUp, keptShows, otherShows],
        [[true, ['Any Workspace', 'Current Workspace']], false, true],
      );
    } finally {
      await inWindow('local', NOTIFICATION_RESET);
    }
  });

  it('F-0402 AC-7 (c104-any): Any Workspace keeps the notification away from every workspace and every folder', async () => {
    const first = workspaceWith('c104-any', {'c104-any-a': true});
    const second = workspaceWith('c104-any-second', {
      'c104-any-second-a': true,
    });
    try {
      const window = await openWorkspaceWindow(first.file);
      await workspaceNoticeShown(window);
      await answerNotification(
        window,
        WORKSPACE_NOTICE_START,
        "Don't Show Again...",
      );
      await answerNotification(window, WORKSPACE_FOLLOW_UP, 'Any Workspace');
      await closeWindow(window);
      const elsewhere = await openWorkspaceWindow(second.file);
      const otherShows = await showsWorkspaceNotice(elsewhere);
      await closeWindow(elsewhere);
      deepStrictEqual(otherShows, false);
    } finally {
      await inWindow('local', NOTIFICATION_RESET);
    }
  });

  it('F-0401 AC-10 (c104-sibling): a saved workspace with one configuration beside its file connects directly, titled as the workspace in its container, with one bind mount of the file’s folder', async () => {
    const workspace = workspaceWith('c104-sibling', {
      'c104-sibling-a': false,
      'c104-sibling-b': false,
    });
    configurationAt(
      workspace.folder,
      '.devcontainer/devcontainer.json',
      'Sibling',
    );
    const window = await openWorkspaceWindow(workspace.file);
    // In its container the window has no folders when its agent starts, so it is named after the workspace file's folder.
    const remote = path.basename(workspace.folder);
    try {
      await startInWindow(window, 'remote-containers.reopenInContainer');
      await connectedToContainer(remote);
      const containers = await devContainersOf(workspace.folder);
      deepStrictEqual(
        [
          (await windowState(remote)).remoteName,
          await windowTitle(remote),
          containers.length,
          await bindSources(containers[0] ?? ''),
        ],
        [
          'dev-container',
          '[c104-sibling (Workspace) [Dev Container: Sibling]]',
          1,
          [workspace.folder],
        ],
      );
    } finally {
      await closeWindow(remote).catch(() => undefined);
      await closeWindow(window).catch(() => undefined);
      await removeContainers(workspace.folder);
    }
  });

  it('c104-siblings, the workspace route’s second shape: two configurations beside the workspace file give the configuration picker, and no container', async () => {
    const workspace = workspaceWith('c104-siblings', {
      'c104-siblings-a': false,
    });
    configurationAt(
      workspace.folder,
      '.devcontainer/one/devcontainer.json',
      'One',
    );
    configurationAt(
      workspace.folder,
      '.devcontainer/two/devcontainer.json',
      'Two',
    );
    const window = await openWorkspaceWindow(workspace.file);
    try {
      await startInWindow(window, 'remote-containers.reopenInContainer');
      await waitForQuickPick(window, 180_000);
      const labels = (await quickPickRows(window)).map(
        pickRow => pickRow.label,
      );
      await closeScreen(window);
      deepStrictEqual(
        [
          labels.filter(label => label === 'One' || label === 'Two').sort(),
          (await windowState(window)).remoteName,
          await devContainersOf(workspace.folder),
        ],
        [['One', 'Two'], null, []],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0401 AC-9 (c104-untitled): an untitled multi-root workspace gets the modal that asks to save it first, with OK only, and the window stays local', async () => {
    const first = devContainerFolder('c104-untitled-a', {name: 'First'});
    const second = devContainerFolder('c104-untitled-b', {name: 'Second'});
    const window = await openFolderWindow(first);
    try {
      await inWindow(window, 'acceptance.agent.addFolder', second);
      await waitFor(
        `window ${window} to become an untitled workspace`,
        async () =>
          (
            await windowState(window).catch(() => undefined)
          )?.workspaceFile?.startsWith('untitled:') === true,
        60_000,
      );
      await startInWindow(window, 'remote-containers.reopenInContainer');
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, dialog.buttons[0] ?? '');
      deepStrictEqual(
        [
          dialog.details,
          dialog.buttons,
          (await windowState(window)).remoteName,
          await devContainersOf(first),
          await devContainersOf(second),
        ],
        [SAVE_FIRST, ['OK'], null, [], []],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
