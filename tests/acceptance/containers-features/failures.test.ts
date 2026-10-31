import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {readFile, rm, writeFile} from 'node:fs/promises';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  reloadingCommand,
  devContainersOf,
  reopenStarted,
  startInWindow,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  dialogOf,
  pressEscape,
  primaryButtonOf,
  type ShownDialog,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  removeControlManifest,
  seedControlManifest,
} from '../windows/control-manifest.ts';
import {servedControlFolder} from '../../../tools/acceptance-templates.ts';
import {runTemplatesReady} from '../windows/run-templates.ts';
import {
  featureBuilds,
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

/** The Feature of the run's manifest that is disallowed with a documentation address. */
const DISALLOWED = 'ghcr.io/devcontainers/features/disallowed-feature:1';

/** The same, with no address. */
function disallowedWithoutAddress(): string {
  return runFeature('lab-banned-nodoc');
}

/** S060's ending: the CLI's check stopped the running container. */
const STOPPED = 'The existing dev container was stopped.';

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

/** S275, the detail of both dialogs about a problematic Feature. */
const REMOVE =
  'Please remove this feature from your devcontainer.json and rebuild the dev container before continuing.';

/** S059 for a Feature, the message of both dialogs. */
function problematic(featureId: string): string {
  return `Cannot use the '${featureId}' feature since it was reported to be problematic.`;
}

/** The detail of the dialog of a build that fails for a reason that is not a Feature's resolution (F-0410). */
const GENERIC = 'An error occurred setting up the container.';

/** The details F-0414 7.E6 gives by the way the failing key fails. */
const EMPTY = 'Empty feature id';
const LEGACY =
  'Legacy feature not supported. Please check https://containers.dev/features for replacements.';
const NOT_FOUND =
  'The feature was not found either because it is no longer available or because of insufficient permissions to access it.';

/** How long a build with Features may take before its dialog, in milliseconds. */
const DIALOG_MILLISECONDS = 600_000;

describe('what a failed build with Features says (card containers-94)', function () {
  this.timeout(1_800_000);

  const {build, closeNow} = featureBuilds();

  before(seedControlManifest);
  after(removeControlManifest);

  const windows: string[] = [];
  const folders: string[] = [];
  const foldersOpened = folders;
  afterEach(async () => {
    for (const window of windows.splice(0)) {
      if ((await dialogOf(window).catch(() => undefined)) !== undefined) {
        await pressEscape(window);
      }
      await closeWindow(window);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });

  /** Opens the folder of `name` and runs Reopen in Container, and gives the dialog that the build ends in. */
  async function failed(
    name: string,
    configuration: Readonly<Record<string, unknown>>,
    prepare?: (folder: string) => void,
    reloads = true,
  ): Promise<ShownDialog & {primary: string | undefined; window: string}> {
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
    return {...dialog, primary: await primaryButtonOf(window), window};
  }

  it('F-0414 7.E6 (empty-key): a Feature whose key is the empty string ends the build with the dialog of F-0410 and the detail S163', async () => {
    const dialog = await failed('c94-empty-key', {features: {'': {}}});
    deepStrictEqual(
      [dialog.details, dialog.buttons],
      [EMPTY, ['Edit devcontainer.json Locally', 'More Actions...', 'Retry']],
    );
  });

  it('F-0414 7.E6 (bare-word): a bare word the CLI does not rewrite ends the build with the detail S220', async () => {
    deepStrictEqual(
      (await failed('c94-bare-word', {features: {fish: {}}})).details,
      LEGACY,
    );
  });

  it('F-0414 7.E6 (not-found): a registry Feature the run’s registry lacks ends the build with the detail S357', async () => {
    deepStrictEqual(
      (
        await failed('c94-not-found', {
          features: {[runFeature('absent-feature')]: {}},
        })
      ).details,
      NOT_FOUND,
    );
  });

  it('F-0414 7.E6 (script-exit): a Feature whose script exits 1 keeps the generic detail of F-0410', async () => {
    deepStrictEqual(
      (
        await failed('c94-script-exit', {features: {'./fexit': {}}}, folder => {
          writeLocalFeature(folder, 'fexit', {script: 'exit 1'});
        })
      ).details,
      GENERIC,
    );
  });

  it('F-0414 AC-17 (local-modal): a disallowed Feature in a local window is refused before the reload with S059 and S275, Cancel and Learn More, and nothing is created', async () => {
    const dialog = await failed(
      'c94-local-modal',
      {features: {[DISALLOWED]: {}}},
      undefined,
      false,
    );
    deepStrictEqual(
      [
        dialog.message,
        dialog.details,
        dialog.buttons,
        dialog.primary,
        (await windowState(dialog.window)).remoteName,
        await devContainersOf(foldersOpened[0] ?? ''),
      ],
      [
        problematic(DISALLOWED),
        REMOVE,
        ['Cancel', 'Learn More'],
        'Learn More',
        null,
        [],
      ],
    );
  });

  it('F-0414 7.E10 (local-no-address): a disallowed Feature whose entry has no address offers Cancel alone', async () => {
    const dialog = await failed(
      'c94-local-nodoc',
      {features: {[disallowedWithoutAddress()]: {}}},
      undefined,
      false,
    );
    deepStrictEqual(
      [dialog.message, dialog.buttons],
      [problematic(disallowedWithoutAddress()), ['Cancel']],
    );
  });

  it('F-0414 AC-20 (container-stays-up): a refusal before the reload leaves a running container of the folder running', async () => {
    const built = await build('c94-stays-up', {});
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

  /** A running container built from `name`, its window ending in the dialog of a rebuild that asks for `featureId`. */
  async function rebuiltWith(
    name: string,
    featureId: string,
  ): Promise<{
    dialog: ShownDialog;
    primary: string | undefined;
    status: string;
  }> {
    const built = await build(name, {});
    askForFeatures(built.folder, {[featureId]: {}});
    await reloadingCommand(built.window, 'remote-containers.rebuildContainer');
    const dialog = await waitForDialog(built.window, DIALOG_MILLISECONDS);
    const {stdout} = await execFileAsync('docker', [
      'inspect',
      '-f',
      '{{.State.Status}}',
      built.containerId,
    ]);
    return {
      dialog,
      primary: await primaryButtonOf(built.window),
      status: stdout.trim(),
    };
  }

  it('F-0414 AC-19, AC-21 (build-step): a rebuild in the container window that the CLI refuses stops the running container and ends in the error dialog with S060 and S275 and the buttons Edit, More Actions and Learn More', async () => {
    const seen = await rebuiltWith('c94-build-step', DISALLOWED);
    deepStrictEqual(
      [
        seen.dialog.message,
        seen.dialog.details,
        seen.dialog.buttons,
        seen.primary,
        seen.status,
      ],
      [
        `${problematic(DISALLOWED)} ${STOPPED}`,
        REMOVE,
        ['Edit devcontainer.json Locally', 'More Actions...', 'Learn More'],
        'Learn More',
        'exited',
      ],
    );
  });

  it('F-0414 AC-49 (build-step-no-address): the same refusal for an entry with no address has the buttons More Actions and Edit, the second primary', async () => {
    const seen = await rebuiltWith(
      'c94-build-nodoc',
      disallowedWithoutAddress(),
    );
    deepStrictEqual(
      [seen.dialog.buttons, seen.primary],
      [
        ['More Actions...', 'Edit devcontainer.json Locally'],
        'Edit devcontainer.json Locally',
      ],
    );
  });

  it('F-0414 AC-22 (manifest-unreachable): with the served manifest gone and no kept copy the local check lets the open go on, the log says so, and the CLI’s refusal ends the build with S059', async () => {
    await rm(manifestFile(), {force: true});
    const served = path.join(
      servedControlFolder(variable('HARNESS_RUN_FOLDER')),
      'devcontainer-control-manifest.json',
    );
    const text = await readFile(served, 'utf8');
    await rm(served);
    try {
      const mark = containersLog().length;
      const dialog = await failed('c94-unreachable', {
        features: {[DISALLOWED]: {}},
      });
      deepStrictEqual(
        [
          dialog.message,
          dialog.buttons,
          containersLogSince(mark).filter(line =>
            line.startsWith('Failed to fetch control manifest: '),
          ).length,
        ],
        [
          problematic(DISALLOWED),
          ['Edit devcontainer.json Locally', 'More Actions...', 'Learn More'],
          1,
        ],
      );
    } finally {
      await writeFile(served, text);
    }
  });

  it('F-0414 AC-24 (advisory): a Feature the manifest advises against is built, and the CLI’s warning with the Feature, its version and the advisory reaches the log', async () => {
    const mark = containersLog().length;
    const built = await build('c94-advisory', {
      features: {[runFeature('lab-advised')]: {}},
    });
    const logged = containersLogSince(mark).join('\n');
    deepStrictEqual(
      [
        logged.includes(
          `${runFeature('lab-advised').replace(/:1$/u, '')}:1.0.0`,
        ),
        logged.includes('The run’s advisory for lab-advised.'),
        logged.includes('introduced in 1.0.0, fixed in 1.0.1'),
        built.containerId === '',
      ],
      [true, true, true, false],
    );
  });

  it('F-0414 AC-23 (lockfile-gone): a lockfile whose digest the registry lacks ends the build of a new container with the dialog', async () => {
    const built = await build('c94-lockfile', {
      features: {[runFeature('lab-plain')]: {}},
    });
    await closeNow(built.window);
    await removeContainers(built.folder);
    const file = path.join(
      built.folder,
      '.devcontainer',
      'devcontainer-lock.json',
    );
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replaceAll(
        /sha256:[0-9a-f]{64}/gu,
        `sha256:${'0'.repeat(64)}`,
      ),
    );
    const window = await openFolderWindow(built.folder);
    windows.push(window);
    await reopenStarted(window);
    const dialog = await waitForDialog(window, DIALOG_MILLISECONDS);
    deepStrictEqual(
      [dialog.message, dialog.details, dialog.buttons],
      [
        '',
        NOT_FOUND,
        ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
      ],
    );
  });
});
