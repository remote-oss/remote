import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {inWindow, variable, waitFor, windowState} from '../windows/harness.ts';
import {
  answerDialog,
  answerFolderDialog,
  dialogKindOf,
  dialogOf,
  dialogText,
  editorTabs,
  notificationCentre,
  pressEscape,
  quickPickFacts,
  type QuickPickFacts,
  windowTitle,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  closeScreen,
  COMMAND,
  startCommand,
  withWindow,
} from './authoring-support.ts';

const REOPEN = 'remote-containers.reopenInContainer';

const OPEN_FOLDER = 'remote-containers.openFolder';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** The frame the template screen has whichever flow opens it: F-0802 AC-1's title, placeholder, no Back button, one choice. */
const TEMPLATE_SCREEN: QuickPickFacts = {
  title: 'Add Dev Container Configuration Files',
  placeholder:
    'Select a container configuration template or enter a custom template id',
  titleButtons: [],
  multiSelect: false,
};

/** Waits for the template screen in `window` and gives its frame. */
async function templateScreenOf(
  window: string,
): Promise<QuickPickFacts | undefined> {
  await waitFor(
    'the template screen',
    async () =>
      (await quickPickFacts(window))?.placeholder ===
      TEMPLATE_SCREEN.placeholder,
    180_000,
  );
  return quickPickFacts(window);
}

/** The text of the modal for a configuration with no container source, as the folder `.devcontainer/devcontainer.json` names it. */
const MISSING_IMAGE =
  "Dev Container configuration '.devcontainer/devcontainer.json' file is missing image information. You can add this manually or overwrite with a template.";

/** The `devcontainer` tab of `window`, if the editor shows one. */
async function configurationTab(
  window: string,
): Promise<{label: string; preview: boolean} | undefined> {
  const found = (await editorTabs(window)).find(
    each => each.label === 'devcontainer',
  );
  return found === undefined
    ? undefined
    : {label: found.label, preview: found.preview};
}

describe('the authoring wizard from the commands that need a configuration (card containers-80)', function () {
  this.timeout(900_000);

  it('F-0802 AC-1 (f1): the command opens the template screen: non-modal, one choice, S302, no Back button, titled for the command', async () => {
    await withWindow('f1', {}, async window => {
      await startCommand(window, COMMAND);
      deepStrictEqual(await templateScreenOf(window), TEMPLATE_SCREEN);
      await closeScreen(window);
    });
  });

  it('F-0301 AC-7, F-0802 AC-1 (f7): Reopen in Container on a folder with no configuration opens the template screen, not an error', async () => {
    await withWindow('f7', {}, async window => {
      await startCommand(window, REOPEN);
      const facts = await templateScreenOf(window);
      const dialog = await dialogOf(window);
      await closeScreen(window);
      deepStrictEqual([facts, dialog], [TEMPLATE_SCREEN, undefined]);
    });
  });

  it('F-0301 AC-49 (f49): configurations only at src/ and three levels down raise no discovery notification, and Reopen in Container opens the template screen', async () => {
    await withWindow(
      'f49',
      {
        'src/devcontainer.json': '{}',
        '.devcontainer/a/b/devcontainer.json': '{}',
      },
      async window => {
        await new Promise(resolve => setTimeout(resolve, 15_000));
        const notices = (await notificationCentre(window)).filter(text =>
          text.startsWith(NOTICE_START),
        );
        await startCommand(window, REOPEN);
        const facts = await templateScreenOf(window);
        await closeScreen(window).catch(async (caught: unknown) => {
          throw new Error(
            `${String(caught)}; pick ${JSON.stringify(await quickPickFacts(window))}; dialog ${JSON.stringify(await dialogText(window))}`,
            {cause: caught},
          );
        });
        deepStrictEqual([notices, facts], [[], TEMPLATE_SCREEN]);
      },
    );
  });

  it('F-0301 AC-10, AC-54, F-0802 AC-1 (f10): a configuration with no container source shows the warning with Cancel and Use Template and no editor behind it; Cancel and Escape open the file as a preview with the window local; Use Template opens the template screen in the same window and leaves the file as it was', async () => {
    const original = '{"name":"x"}';
    await withWindow(
      'f10',
      {'.devcontainer/devcontainer.json': original},
      async (window, folder) => {
        const seen: unknown[] = [];
        for (const closing of ['Cancel', 'Escape'] as const) {
          await inWindow(window, 'workbench.action.closeAllEditors');
          await startCommand(window, REOPEN);
          const dialog = await waitForDialog(window, 180_000);
          const said = await dialogText(window);
          const kind = await dialogKindOf(window);
          const behind = await configurationTab(window);
          if (closing === 'Cancel') {
            await answerDialog(window, 'Cancel');
          } else {
            await pressEscape(window);
          }
          await waitFor(
            'the configuration to open',
            async () => (await configurationTab(window)) !== undefined,
            30_000,
          );
          seen.push([
            said === `CancelUse Template${MISSING_IMAGE}`,
            kind,
            dialog.buttons,
            behind,
            await configurationTab(window),
            (await windowState(window)).remoteName,
          ]);
        }
        await inWindow(window, 'workbench.action.closeAllEditors');
        await startCommand(window, REOPEN);
        await waitForDialog(window, 180_000);
        await answerDialog(window, 'Use Template');
        const facts = await templateScreenOf(window);
        await closeScreen(window);
        const preview = {label: 'devcontainer', preview: true};
        deepStrictEqual(
          [
            seen,
            facts,
            (await windowState(window)).remoteName,
            readFileSync(
              path.join(folder, '.devcontainer/devcontainer.json'),
              'utf8',
            ),
          ],
          [
            [
              [
                true,
                'warning',
                ['Cancel', 'Use Template'],
                undefined,
                preview,
                null,
              ],
              [
                true,
                'warning',
                ['Cancel', 'Use Template'],
                undefined,
                preview,
                null,
              ],
            ],
            TEMPLATE_SCREEN,
            null,
            original,
          ],
        );
      },
    );
  });

  it('F-0802 AC-1 (fa): Open Folder in Container on an empty folder opens the template screen while the window still shows the start folder', async () => {
    const target = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'authoring',
      'fa-target',
    );
    rmSync(target, {recursive: true, force: true});
    mkdirSync(target, {recursive: true});
    await withWindow('fa', {}, async (window, folder) => {
      await startCommand(window, OPEN_FOLDER);
      await answerFolderDialog(window, target);
      const facts = await templateScreenOf(window);
      const title = await windowTitle(window);
      await closeScreen(window);
      deepStrictEqual(
        [facts, title],
        [TEMPLATE_SCREEN, `[${path.basename(folder)}]`],
      );
    });
  });
});
