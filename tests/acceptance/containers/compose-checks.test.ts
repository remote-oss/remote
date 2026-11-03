import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  devContainersOf,
  inWindow,
  reopenStarted,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  answerDialog,
  pressEscape,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  composeContainersOfRun,
  composeFolder,
  type ComposeFolderOptions,
  removeComposeContainers,
} from './compose-support.ts';

/** The generic dialog of a setup that fails (F-0410's). */
const GENERIC_DIALOG = 'An error occurred setting up the container.';

/** The text of the S412 dialog. */
const S412 = 'Workspace folder not specified in devcontainer.json.';

/** What a window shows of its place after a dialog is gone. */
async function placeOf(name: string): Promise<{
  remote: string | null | undefined;
  editor: string | null | undefined;
  indicator: string;
}> {
  const state = await windowState(name).catch(() => undefined);
  return {
    remote: state?.remoteName,
    editor: state?.activeTab?.uri,
    indicator: await statusBarText(name, 'status.host').catch(() => ''),
  };
}

describe('the checks of a Compose configuration before and while it connects (card containers-143, part B)', function () {
  this.timeout(300_000);

  afterEach(async () => {
    await removeComposeContainers();
  });

  it('F-0301 AC-20, AC-63, F-0411 AC-17, AC-39 (c143-workspace-folder): a Compose configuration with no workspaceFolder, or an empty one, shows S412 with Open devcontainer.json before anything is created; Cancel leaves the window as it was and the button opens the file as a preview', async () => {
    const results: unknown[] = [];
    for (const [label, configuration] of [
      ['absent', {workspaceFolder: undefined}],
      ['empty', {workspaceFolder: ''}],
    ] as const) {
      const folder = composeFolder({
        name: `c143-wf-${label}`,
        place: 'devcontainer',
        configuration,
      });
      const name = await openFolderWindow(folder);
      const before = await placeOf(name);
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      running.catch(() => undefined);
      const dialog = await waitForDialog(name, 60_000);
      const shown = [dialog.message, dialog.details].filter(
        line => line !== '',
      );
      await answerDialog(name, 'Cancel');
      await running.catch(() => undefined);
      const afterCancel = await placeOf(name);
      const again = inWindow(name, 'remote-containers.reopenInContainer');
      again.catch(() => undefined);
      await waitForDialog(name, 60_000);
      await answerDialog(name, 'Open devcontainer.json');
      await again.catch(() => undefined);
      const afterOpen = await placeOf(name);
      results.push({
        label,
        shown,
        buttons: dialog.buttons,
        unchanged: JSON.stringify(afterCancel) === JSON.stringify(before),
        opened: afterOpen.editor?.endsWith('.devcontainer/devcontainer.json'),
        remote: afterOpen.remote,
        containers: await composeContainersOfRun(),
      });
      await closeWindow(name);
    }
    deepStrictEqual(
      results,
      ['absent', 'empty'].map(label => ({
        label,
        shown: [S412],
        buttons: ['Cancel', 'Open devcontainer.json'],
        unchanged: true,
        opened: true,
        remote: null,
        containers: [],
      })),
    );
  });

  it('F-0301 AC-70 (c143-workspace-folder-escape): Escape on the S412 dialog acts as Cancel', async () => {
    const folder = composeFolder({
      name: 'c143-wf-escape',
      place: 'devcontainer',
      configuration: {workspaceFolder: undefined},
    });
    const name = await openFolderWindow(folder);
    const before = await placeOf(name);
    const running = inWindow(name, 'remote-containers.reopenInContainer');
    running.catch(() => undefined);
    await waitForDialog(name, 60_000);
    await pressEscape(name);
    await running.catch(() => undefined);
    const after = await placeOf(name);
    await closeWindow(name);
    deepStrictEqual(after, before);
  });

  it('F-0301 AC-12, F-0413 AC-2, AC-11, AC-13, AC-14, AC-15, AC-53 (c143-failures): a missing compose file, a YAML error, a model Compose rejects, a service the model lacks and no service at all each give the generic dialog, with no container and no text of Compose’s own', async () => {
    const cases: Array<[string, Partial<ComposeFolderOptions>]> = [
      ['missing-file', {configuration: {dockerComposeFile: 'missing.yml'}}],
      ['yaml-error', {composeText: 'services: [unclosed\n'}],
      ['bad-model', {composeText: 'services:\n  - app\n  - db\n'}],
      ['no-such-service', {configuration: {service: 'nowhere'}}],
      ['no-service', {configuration: {service: undefined}}],
    ];
    const results: Array<[string, string, string[], string[]]> = [];
    for (const [label, options] of cases) {
      const folder = composeFolder({
        name: `c143-fail-${label}`,
        place: 'devcontainer',
        ...options,
      });
      const name = await openFolderWindow(folder);
      try {
        await reopenStarted(name);
        const dialog = await waitForDialog(name, 90_000);
        results.push([
          label,
          [dialog.message, dialog.details]
            .filter(line => line !== '')
            .join(' | '),
          [...dialog.buttons].sort(),
          [
            ...(await devContainersOf(folder)),
            ...(await composeContainersOfRun()),
          ],
        ]);
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    }
    deepStrictEqual(
      results,
      cases.map(([label]) => [
        label,
        GENERIC_DIALOG,
        ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
        [],
      ]),
    );
  });
});
