import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  activations,
  openWorkspaceWindow,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  isTrusted,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  notificationCentre,
  quickPickFacts,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  closeScreen,
  rowsOf,
  screenOf,
  startCommand,
  withWindow,
} from '../windows/authoring-support.ts';

const REOPEN = 'remote-containers.reopenInContainer';

/** The placeholder of the pick that asks where to create the configuration. */
const WHERE_PLACEHOLDER =
  'Where would you like to create your container configuration?';

const TRUST_SETTING = 'security.workspace.trust.enabled';

describe('the template screen in Restricted Mode (card coverage-72)', function () {
  this.timeout(600_000);

  afterEach(async () => {
    await setUserSetting(TRUST_SETTING, undefined);
  });

  it('F-0802 AC-21 (c72-trust-list): the template screen and the chooser of a folder with a Dockerfile open with no trust prompt in an untrusted folder, with the same items as in a trusted one', async () => {
    const seen: Array<{
      trusted: boolean | undefined;
      dialog: unknown;
      rows: string[][];
    }> = [];
    async function lookIn(
      name: string,
      contents: Record<string, string>,
    ): Promise<void> {
      await withWindow(name, contents, async window => {
        const rows = (await screenOf(window)).map(each => [
          each.label,
          each.description,
          each.detail,
          each.icons.join(' '),
        ]);
        seen.push({
          trusted: await isTrusted(window),
          dialog: await dialogOf(window),
          rows,
        });
        await closeScreen(window);
      });
    }
    const dockerfile = {Dockerfile: 'FROM alpine\n'};
    await lookIn('c72-restricted', {});
    await lookIn('c72-restricted-chooser', dockerfile);
    // With the setting off, core treats every folder as trusted.
    await setUserSetting(TRUST_SETTING, false);
    await lookIn('c72-trusted', {});
    await lookIn('c72-trusted-chooser', dockerfile);
    deepStrictEqual(
      [
        seen.map(each => [each.trusted, each.dialog]),
        [0, 1].map(
          position =>
            seen[position]?.rows.join('|') ===
            seen[position + 2]?.rows.join('|'),
        ),
        seen[0]?.rows.join('|') === seen[1]?.rows.join('|'),
      ],
      [
        [
          [false, undefined],
          [false, undefined],
          [true, undefined],
          [true, undefined],
        ],
        [true, true],
        false,
      ],
    );
  });

  it('F-0106 AC-2 (c101-trust-continue): in an untrusted folder with no configuration, Trust Folder & Continue makes the folder trusted with no reload of the window and the flow goes on to the location pick', async () => {
    await withWindow('c101-trust-continue', {}, async window => {
      const activated = activations(window);
      const before = await isTrusted(window);
      await startCommand(window, REOPEN);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Trust Folder & Continue');
      await waitFor(
        'the location pick',
        async () =>
          (await quickPickFacts(window))?.placeholder === WHERE_PLACEHOLDER,
        60_000,
      );
      const seen = [
        before,
        await isTrusted(window),
        activations(window) === activated,
        (await windowState(window)).remoteName,
      ];
      await closeScreen(window);
      deepStrictEqual(seen, [false, true, true, null]);
    });
  });

  it('F-0106 AC-44 (c104-trust-workspace): in an untrusted multi-root workspace whose member folder has a configuration, Trust Workspace & Continue closes the dialog with no reload, the same window shows the location pick, and no connecting notification appears', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'c104-trust');
    rmSync(folder, {recursive: true, force: true});
    mkdirSync(folder, {recursive: true});
    devContainerFolder(path.join('c104-trust', 'c104-trust-a'), {name: 'A'});
    mkdirSync(path.join(folder, 'c104-trust-b'));
    const file = path.join(folder, 'c104-trust.code-workspace');
    writeFileSync(
      file,
      JSON.stringify({
        folders: [{path: 'c104-trust-a'}, {path: 'c104-trust-b'}],
      }),
    );
    const window = await openWorkspaceWindow(file);
    try {
      const activated = activations(window);
      const before = await isTrusted(window);
      await startCommand(window, REOPEN);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Trust Workspace & Continue');
      await waitFor(
        'the location pick',
        async () =>
          (await quickPickFacts(window))?.placeholder === WHERE_PLACEHOLDER,
        60_000,
      );
      const seen: unknown[] = [
        before,
        await isTrusted(window),
        activations(window) === activated,
        (await quickPickFacts(window))?.title,
        (await rowsOf(window)).map(([label]) => label),
      ];
      // Opening the notification centre would close the pick, so it is read once the screen is closed.
      await closeScreen(window);
      seen.push(
        (await notificationCentre(window)).filter(text =>
          text.startsWith('Connecting to Dev Container'),
        ),
        await dialogOf(window),
      );
      deepStrictEqual(seen, [
        false,
        true,
        true,
        'Add Dev Container Configuration Files',
        [
          'Add configuration to workspace',
          'Add configuration to user data folder',
        ],
        [],
        undefined,
      ]);
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
