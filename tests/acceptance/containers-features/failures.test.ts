import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {servedControlFolder} from '../../../tools/acceptance-templates.ts';
import {
  removeControlManifest,
  seedControlManifest,
} from '../windows/control-manifest.ts';
import {
  activations,
  openFolderWindow,
  removeContainers,
} from '../windows/folder-windows.ts';
import {
  activeEditorOf,
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  reloadingCommand,
  reopenStarted,
  startInWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  type DialogKind,
  dialogKindOf,
  dialogOf,
  notifications,
  pressEscape,
  primaryButtonOf,
  type ShownDialog,
  waitForDialog,
} from '../windows/renderer.ts';
import {runTemplatesReady} from '../windows/run-templates.ts';
import {installBrowser, openedUrls} from '../windows/web-ui-support.ts';
import {
  featureBuilds,
  imagesOf,
  runFeature,
  writeLocalFeature,
} from './features-support.ts';

const execFileAsync = promisify(execFile);

/** Writes `features` into the configuration of the folder, keeping the rest of it. */
function askForFeatures(
  folder: string,
  features: Readonly<Record<string, unknown>>,
): void {
  const file = path.join(folder, '.devcontainer', 'devcontainer.json');
  const configuration = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    unknown
  >;
  writeFileSync(file, JSON.stringify({...configuration, features}));
}

/** The Feature of the run's manifest that is disallowed with a documentation address, and the address. */
const DISALLOWED = 'ghcr.io/devcontainers/features/disallowed-feature:1';
const DOCUMENTATION =
  'https://github.com/devcontainers/features/tree/main/src/disallowed-feature#readme';

/** The same, with no address. */
function disallowedWithoutAddress(): string {
  return runFeature('lab-banned-nodoc');
}

/** The kept copy of the control manifest, in the extension's global storage. */
function manifestFile(): string {
  return path.join(
    variable('HARNESS_USER_DATA'),
    'User',
    'globalStorage',
    'remote-oss.remote-containers',
    'control-manifest.json',
  );
}

/** S275, the detail of the dialogs about a problematic Feature. */
const REMOVE =
  'Please remove this feature from your devcontainer.json and rebuild the dev container before continuing.';

/** S059 for a Feature, the message of the dialogs about it. */
function problematic(featureId: string): string {
  return `Cannot use the '${featureId}' feature since it was reported to be problematic.`;
}

/** S060's ending: the CLI's check stopped the running container. */
const STOPPED = 'The existing dev container was stopped.';

/** The detail of the dialog of a build that fails for a reason that is not a Feature's resolution (F-0410). */
const GENERIC = 'An error occurred setting up the container.';

/** The details F-0414 7.E6 gives by the way the failing key fails. */
const EMPTY = 'Empty feature id';
const LEGACY =
  'Legacy feature not supported. Please check https://containers.dev/features for replacements.';
const NOT_FOUND =
  'The feature was not found either because it is no longer available or because of insufficient permissions to access it.';

/** The buttons of the dialog of a failed build, as the page holds them: Retry is the primary one, the last. */
const BUILD_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** The buttons of the dialog about a disallowed Feature caught by the build step, with an address. */
const STEP_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Learn More',
];

/** How long a build with Features may take before its dialog, in milliseconds. */
const DIALOG_MILLISECONDS = 600_000;

/** What a row reads of the dialog its open ends in. */
interface Failure extends ShownDialog {
  primary: string | undefined;
  kind: DialogKind | undefined;
  window: string;
  folder: string;
  toasts: string[];
}

describe('what a failed build with Features says (card containers-94)', function () {
  this.timeout(1_800_000);

  const {build, closeNow} = featureBuilds();

  before(seedControlManifest);
  after(removeControlManifest);

  const windows: string[] = [];
  const folders: string[] = [];
  afterEach(async () => {
    for (const window of windows.splice(0)) {
      await release(window);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });

  /** Dismisses the dialog window `window` has open, if any, and closes the window. */
  async function release(window: string): Promise<void> {
    if ((await dialogOf(window).catch(() => undefined)) !== undefined) {
      await pressEscape(window);
    }
    await closeWindow(window);
  }

  /** Whether the folder has a container, and the images its build made. */
  async function leftBy(
    folder: string,
    name: string,
  ): Promise<{containers: string[]; images: string[]}> {
    return {
      containers: await devContainersOf(folder),
      images: await imagesOf(`vsc-${name}`),
    };
  }

  /**
   * Opens the folder of `name` and runs Reopen in Container, and gives the dialog that it ends in. With `reloads` false
   * the command ends in a dialog of the local window, and the window does not reload.
   */
  async function failed(
    name: string,
    configuration: Readonly<Record<string, unknown>>,
    prepare?: (folder: string) => void,
    reloads = true,
  ): Promise<Failure> {
    await runTemplatesReady();
    const folder = devContainerFolder(name, configuration);
    folders.push(folder);
    prepare?.(folder);
    const window = await openFolderWindow(folder);
    windows.push(window);
    if (reloads) {
      await reopenStarted(window);
    } else {
      await startInWindow(window, 'remote-containers.reopenInContainer');
    }
    const dialog = await waitForDialog(window, DIALOG_MILLISECONDS);
    return {
      ...dialog,
      primary: await primaryButtonOf(window),
      kind: await dialogKindOf(window),
      window,
      folder,
      toasts: (await notifications(window)).filter(
        text => !text.startsWith('Connecting to Dev Container'),
      ),
    };
  }

  /** The dialog a failed build of `key` ends in, and what the build left, closed after. */
  async function failedWith(
    name: string,
    key: string,
  ): Promise<Failure & {left: {containers: string[]; images: string[]}}> {
    const seen = await failed(name, {features: {[key]: {}}});
    const left = await leftBy(seen.folder, name);
    windows.splice(windows.indexOf(seen.window), 1);
    await release(seen.window);
    return {...seen, left};
  }

  it('F-0414 AC-12 (unresolvable-keys): each key that cannot be resolved ends Reopen in Container with an error modal with Edit, More Actions and Retry (primary), no notification, and no container or image', async () => {
    const keys = [
      '/etc/foo',
      'http://example.invalid/x',
      'owner/repo',
      'owner/repo/bad id!',
      'ghcr.io/owner/bad id!',
      runFeature('absent-feature'),
    ];
    const seen: unknown[] = [];
    for (const [index, key] of keys.entries()) {
      const dialog = await failedWith(`c94-ac12-${String(index)}`, key);
      seen.push([
        dialog.kind,
        dialog.buttons,
        dialog.primary,
        dialog.toasts,
        dialog.left,
      ]);
    }
    deepStrictEqual(
      seen,
      keys.map(() => [
        'error',
        BUILD_BUTTONS,
        'Retry',
        [],
        {containers: [], images: []},
      ]),
    );
  });

  it('F-0414 AC-13 (nonexistent-oci-id): a well-formed OCI id the registry lacks ends the build with the detail S357', async () => {
    deepStrictEqual(
      (await failedWith('c94-ac13', runFeature('absent-feature'))).details,
      NOT_FOUND,
    );
  });

  it('F-0414 AC-14 (bare-words): fish and myrandomfeature end the build with the detail S220', async () => {
    deepStrictEqual(
      [
        (await failedWith('c94-ac14-fish', 'fish')).details,
        (await failedWith('c94-ac14-random', 'myrandomfeature')).details,
      ],
      [LEGACY, LEGACY],
    );
  });

  it('F-0414 AC-15 (empty-key): the empty key ends the build with the detail S163', async () => {
    deepStrictEqual((await failedWith('c94-ac15', '')).details, EMPTY);
  });

  it('F-0414 AC-17 (local-modal): a disallowed Feature in a local window is refused before the reload with a warning modal with S059 and S275, Cancel and Learn More (primary), and nothing is created', async () => {
    const dialog = await failed(
      'c94-ac17',
      {features: {[DISALLOWED]: {}}},
      undefined,
      false,
    );
    deepStrictEqual(
      [
        dialog.kind,
        dialog.message,
        dialog.details,
        dialog.buttons,
        dialog.primary,
        (await windowState(dialog.window)).remoteName,
        await leftBy(dialog.folder, 'c94-ac17'),
      ],
      [
        'warning',
        problematic(DISALLOWED),
        REMOVE,
        ['Cancel', 'Learn More'],
        'Learn More',
        null,
        {containers: [], images: []},
      ],
    );
  });

  it('F-0414 AC-18 (learn-more): Learn More opens the entry’s address, and Cancel and Escape open nothing and leave the window local', async () => {
    installBrowser();
    const folder = devContainerFolder('c94-ac18', {
      features: {[DISALLOWED]: {}},
    });
    folders.push(folder);
    const window = await openFolderWindow(folder);
    windows.push(window);
    const opened: string[][] = [];
    for (const answer of ['Escape', 'Cancel', 'Learn More']) {
      await startInWindow(window, 'remote-containers.reopenInContainer');
      await waitForDialog(window, DIALOG_MILLISECONDS);
      if (answer === 'Escape') {
        await pressEscape(window);
      } else {
        await answerDialog(window, answer);
      }
      if (answer === 'Learn More') {
        // Core asks before it opens an address of a domain it does not trust yet.
        await waitForDialog(window, 30_000);
        await answerDialog(window, 'Open');
      }
      await waitFor(
        `the dialog to close after ${answer}`,
        async () => (await dialogOf(window)) === undefined,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
      opened.push(openedUrls());
    }
    deepStrictEqual(
      [opened, (await windowState(window)).remoteName],
      [[[], [], [DOCUMENTATION]], null],
    );
  });

  it('F-0414 AC-19 (build-step): a rebuild with a disallowed Feature ends in an error modal with S059 and S275 and the buttons Edit, More Actions and Learn More (primary), the previous container is gone, and Edit reopens the folder locally with the file in the editor', async () => {
    const built = await build('c94-ac19', {});
    askForFeatures(built.folder, {[DISALLOWED]: {}});
    await reloadingCommand(built.window, 'remote-containers.rebuildContainer');
    const dialog = await waitForDialog(built.window, DIALOG_MILLISECONDS);
    const seen = [
      await dialogKindOf(built.window),
      dialog.message,
      dialog.details,
      dialog.buttons,
      await primaryButtonOf(built.window),
      await devContainersOf(built.folder),
    ];
    const before = activations(built.window);
    await answerDialog(built.window, 'Edit devcontainer.json Locally');
    await waitFor(
      'the window to activate in its local folder',
      () => activations(built.window) > before,
      30_000,
    );
    const configuration = path.join(
      built.folder,
      '.devcontainer',
      'devcontainer.json',
    );
    await waitFor(
      `the active editor to be ${configuration}`,
      async () => (await activeEditorOf(built.window)) === configuration,
      30_000,
    );
    const local = await windowState(built.window);
    deepStrictEqual(
      [seen, local.remoteName],
      [
        [
          'error',
          problematic(DISALLOWED),
          REMOVE,
          STEP_BUTTONS,
          'Learn More',
          [],
        ],
        null,
      ],
    );
  });

  it('F-0414 AC-20 (container-stays-up): a refusal before the reload leaves a running container of the folder running, with S059 and not S060', async () => {
    const built = await build('c94-ac20', {shutdownAction: 'none'});
    await closeNow(built.window);
    askForFeatures(built.folder, {[DISALLOWED]: {}});
    const window = await openFolderWindow(built.folder);
    windows.push(window);
    await startInWindow(window, 'remote-containers.reopenInContainer');
    const dialog = await waitForDialog(window, DIALOG_MILLISECONDS);
    const {stdout} = await execFileAsync('docker', [
      'inspect',
      '-f',
      '{{.State.Status}}',
      built.containerId,
    ]);
    deepStrictEqual(
      [dialog.message, stdout.trim()],
      [problematic(DISALLOWED), 'running'],
    );
  });

  it('F-0414 AC-22 (manifest-404): with the manifest fetch failing and no kept copy a build with a local feature completes and connects, the log has the S177 line, and no dialog or notification appears', async () => {
    await rm(manifestFile(), {force: true});
    const served = path.join(
      servedControlFolder(variable('HARNESS_RUN_FOLDER')),
      'devcontainer-control-manifest.json',
    );
    const text = await readFile(served, 'utf8');
    await rm(served);
    try {
      const mark = containersLog().length;
      const built = await build(
        'c94-ac22',
        {features: {'./plain': {}}},
        folder => {
          writeLocalFeature(folder, 'plain');
        },
      );
      deepStrictEqual(
        [
          containersLogSince(mark).filter(line =>
            line.startsWith('Failed to fetch control manifest: '),
          ).length,
          await dialogOf(built.window),
          await notifications(built.window),
        ],
        [1, undefined, []],
      );
    } finally {
      await writeFile(served, text);
    }
  });

  it('F-0414 7.E11 (unreachable-then-step): with the manifest unreachable and no kept copy the local check lets the open go on, and the CLI’s refusal ends the build with S059', async () => {
    await rm(manifestFile(), {force: true});
    const served = path.join(
      servedControlFolder(variable('HARNESS_RUN_FOLDER')),
      'devcontainer-control-manifest.json',
    );
    const text = await readFile(served, 'utf8');
    await rm(served);
    try {
      const dialog = await failed('c94-711', {features: {[DISALLOWED]: {}}});
      deepStrictEqual(
        [dialog.message, dialog.buttons],
        [problematic(DISALLOWED), STEP_BUTTONS],
      );
    } finally {
      await writeFile(served, text);
    }
  });

  it('F-0414 AC-23 (lockfile-gone): a lockfile entry pinned to a digest the registry lacks ends Rebuild Container Without Cache with the 7.E6 dialog, an unchanged lockfile and no previous container', async () => {
    const built = await build('c94-ac23', {
      features: {[runFeature('lab-plain')]: {}},
    });
    const file = path.join(
      built.folder,
      '.devcontainer',
      'devcontainer-lock.json',
    );
    const pinned = readFileSync(file, 'utf8').replaceAll(
      /sha256:[0-9a-f]{64}/gu,
      `sha256:${'0'.repeat(64)}`,
    );
    writeFileSync(file, pinned);
    await reloadingCommand(
      built.window,
      'remote-containers.rebuildContainerNoCache',
    );
    const dialog = await waitForDialog(built.window, DIALOG_MILLISECONDS);
    deepStrictEqual(
      [
        dialog.details,
        dialog.buttons,
        readFileSync(file, 'utf8') === pinned,
        await devContainersOf(built.folder),
      ],
      [NOT_FOUND, BUILD_BUTTONS, true, []],
    );
  });

  it('F-0414 AC-24 (advisory): a Feature the manifest advises against is built, and the log has a warning naming the Feature, its version and the advisory', async () => {
    const mark = containersLog().length;
    const built = await build('c94-ac24', {
      features: {[runFeature('lab-advised')]: {}},
    });
    const lines = containersLogSince(mark);
    const named = lines.findIndex(line =>
      line.includes(`${runFeature('lab-advised').replace(/:1$/u, '')}:1.0.0`),
    );
    deepStrictEqual(
      [
        named >= 0,
        lines[named + 1]?.includes('The run’s advisory for lab-advised.'),
        lines[named + 1]?.includes('introduced in 1.0.0, fixed in 1.0.1'),
        built.containerId === '',
      ],
      [true, true, true, false],
    );
  });

  it('F-0414 AC-26 (dependency-cycle): two local Features that depend on each other end the build with the generic detail and no container or image', async () => {
    const dialog = await failed(
      'c94-ac26',
      {features: {'./feature-a': {}}},
      folder => {
        writeLocalFeature(folder, 'feature-a', {
          metadata: {dependsOn: {'./feature-b': {}}},
        });
        writeLocalFeature(folder, 'feature-b', {
          metadata: {dependsOn: {'./feature-a': {}}},
        });
      },
    );
    deepStrictEqual(
      [dialog.details, await leftBy(dialog.folder, 'c94-ac26')],
      [GENERIC, {containers: [], images: []}],
    );
  });

  it('F-0414 AC-38 (github-release-key): octocat/Hello-World/foo ends a build attempt with the 7.E6 dialog and no container or image', async () => {
    const dialog = await failedWith('c94-ac38', 'octocat/Hello-World/foo');
    deepStrictEqual(
      [dialog.details, dialog.buttons, dialog.left],
      [NOT_FOUND, BUILD_BUTTONS, {containers: [], images: []}],
    );
  });

  it('F-0414 AC-39 (script-exit): a local Feature whose script exits 1 ends the build with the generic detail, an empty Notification Center, the Feature and its documentation address in the log, and no container or image', async () => {
    const mark = containersLog().length;
    const dialog = await failed(
      'c94-ac39',
      {features: {'./fexit': {}}},
      folder => {
        writeLocalFeature(folder, 'fexit', {
          metadata: {documentationURL: 'https://example.org/fexit'},
          script: 'exit 1',
        });
      },
    );
    const logged = containersLogSince(mark).join('\n');
    deepStrictEqual(
      [
        dialog.details,
        dialog.toasts,
        logged.includes('fexit'),
        logged.includes('https://example.org/fexit'),
        await leftBy(dialog.folder, 'c94-ac39'),
      ],
      [GENERIC, [], true, true, {containers: [], images: []}],
    );
  });

  it('F-0414 AC-42 (order-string): overrideFeatureInstallOrder as a string ends the build with the generic detail and no container', async () => {
    const dialog = await failed(
      'c94-ac42',
      {
        features: {'./plain': {}},
        overrideFeatureInstallOrder: 'ghcr.io/devcontainers/features/node',
      },
      folder => {
        writeLocalFeature(folder, 'plain');
      },
    );
    deepStrictEqual(
      [dialog.details, await devContainersOf(dialog.folder)],
      [GENERIC, []],
    );
  });

  it('F-0414 AC-49 (build-step-no-address): the CLI’s refusal of an entry with no address shows S059 and S275 with an error icon and the buttons More Actions and Edit, the second primary, without Learn More', async () => {
    const built = await build('c94-ac49', {});
    askForFeatures(built.folder, {[disallowedWithoutAddress()]: {}});
    await reloadingCommand(built.window, 'remote-containers.rebuildContainer');
    const dialog = await waitForDialog(built.window, DIALOG_MILLISECONDS);
    deepStrictEqual(
      [
        await dialogKindOf(built.window),
        dialog.message,
        dialog.details,
        dialog.buttons,
        await primaryButtonOf(built.window),
      ],
      [
        'error',
        problematic(disallowedWithoutAddress()),
        REMOVE,
        ['More Actions...', 'Edit devcontainer.json Locally'],
        'Edit devcontainer.json Locally',
      ],
    );
  });

  it('F-0414 AC-21 (cli-stops-running): with the manifest 404 and a running container, Reopen from the local window reaches the CLI’s check, which stops the container and ends the build with S060', async () => {
    const built = await build('c94-ac21', {});
    await closeNow(built.window);
    askForFeatures(built.folder, {[DISALLOWED]: {}});
    await rm(manifestFile(), {force: true});
    const served = path.join(
      servedControlFolder(variable('HARNESS_RUN_FOLDER')),
      'devcontainer-control-manifest.json',
    );
    const text = await readFile(served, 'utf8');
    await rm(served);
    try {
      const window = await openFolderWindow(built.folder);
      windows.push(window);
      await reopenStarted(window);
      const dialog = await waitForDialog(window, DIALOG_MILLISECONDS);
      const {stdout} = await execFileAsync('docker', [
        'inspect',
        '-f',
        '{{.State.Status}}',
        built.containerId,
      ]);
      deepStrictEqual(
        [dialog.message, dialog.buttons, stdout.trim()],
        [`${problematic(DISALLOWED)} ${STOPPED}`, STEP_BUTTONS, 'exited'],
      );
    } finally {
      await writeFile(served, text);
    }
  });
});
