import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  inWindow,
  isTrusted,
  trustSettled,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {
  problemsOf,
  type Problem,
  statusBarText,
  pressEscape,
  evaluate,
} from '../windows/renderer.ts';

/** The schema the manifest points devcontainer-feature.json at. */
const SCHEMA_URL =
  'https://raw.githubusercontent.com/devcontainers/spec/main/schemas/devContainerFeature.schema.json';

/** The warning core gives when the schema download is blocked in Restricted Mode. */
const SCHEMA_BLOCKED = `Unable to load schema from '${SCHEMA_URL}': Downloading schemas is disabled in untrusted workspaces.`;

/** The text of STR:S294, on a `devcontainers-contrib` entry. */
const S294 =
  'Replace the reference to the discontinued `devcontainers-contrib` with `devcontainers-extra`';

/** The code of the Feature-id problems, and the page its link opens. */
const REFERENCING =
  'https://containers.dev/implementors/features/#referencing-a-feature';

/** The words of the schema validation state, from the language status. */
const NO_SCHEMA = 'No schema validation, no JSON schema configured';

/** The valid metadata of a `devcontainer-feature.json`. */
const VALID_FEATURE =
  '{\n  // the metadata\n  "id": "remote-oss/probe",\n  "version": "1.0.0",\n  "name": "Probe",\n  "description": "A Feature that only probes."\n}\n';

/** The `devcontainer.json` of a folder, with the entry of the discontinued namespace. */
const CONTRIB =
  '{\n  "image": "alpine:3.22",\n  "features": {\n    "ghcr.io/devcontainers-contrib/features/curl-apt-get:1.0.0": {}\n  }\n}\n';

/** The folder `name` with `file` (relative to the folder's root) holding `text`. */
function folderWithFile(name: string, file: string, text: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  const target = path.join(folder, file);
  mkdirSync(path.dirname(target), {recursive: true});
  writeFileSync(target, text);
  return folder;
}

/** Waits until the language status menu of window `name` holds the item `entry`. */
async function settledStatusOf(name: string, entry: string): Promise<void> {
  await waitFor(
    `the language status of window ${name} reading ${JSON.stringify(entry)}`,
    async () => (await languageStatusOf(name)).menu.includes(entry),
    90_000,
  );
}

/** The language item of window `name`'s status bar with the items of the menu clicking it shows, read and closed. */
async function languageStatusOf(
  name: string,
): Promise<{item: string; menu: string[]}> {
  const item = await statusBarText(name, 'status.language');
  await evaluate<boolean>(
    name,
    `(() => {
      const entry = document.getElementById('status.language');
      entry?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
      return entry !== null;
    })()`,
  );
  let menu: string[] = [];
  await waitFor(
    `the language status menu of window ${name}`,
    async () => {
      menu = await evaluate<string[]>(
        name,
        `[...document.querySelectorAll('.context-view [role="menuitem"]')].map(each => (each.textContent ?? '').trim()).filter(text => text !== '')`,
      );
      return menu.length > 0;
    },
    15_000,
  );
  await pressEscape(name);
  return {item, menu};
}

describe('the authoring aids in Restricted Mode (card containers-208)', function () {
  this.timeout(600_000);
  let window = '';
  afterEach(async () => {
    if (window !== '') {
      await closeWindow(window);
      window = '';
    }
  });

  /** Opens `file` of `folder` in a new window and gives the window and its problems once there are `count` of them. */
  async function problemsWithFile(
    folder: string,
    file: string,
    count: number,
  ): Promise<Problem[]> {
    window = await openFolderWindow(folder);
    await inWindow(window, 'acceptance.agent.openFile', file);
    let problems: Problem[] = [];
    await waitFor(
      `${String(count)} problems in window ${window}`,
      async () => {
        problems = await problemsOf(window);
        return problems.length === count;
      },
      60_000,
    );
    return problems;
  }

  it('F-0810 AC-3 (c208-ac3): a devcontainer-feature.json in an untrusted workspace earns exactly the schema-download warning, with no property diagnostic', async () => {
    const folder = folderWithFile(
      'c208-ac3',
      'devcontainer-feature.json',
      VALID_FEATURE,
    );
    const problems = await problemsWithFile(
      folder,
      'devcontainer-feature.json',
      1,
    );
    deepStrictEqual(
      [
        await isTrusted(window),
        problems.map(each => [each.file, each.message, each.severity]),
      ],
      [false, [['devcontainer-feature.json', SCHEMA_BLOCKED, 'warning']]],
    );
  });

  it('F-0810 AC-5 (c208-ac5-untrusted): a .devcontainer-internal.json earns no diagnostic in the untrusted workspace either, and the language status names no schema', async () => {
    const folder = folderWithFile(
      'c208-ac5-untrusted',
      '.devcontainer-internal.json',
      '{\n  // the internal file\n  "bogusProperty": true\n}\n',
    );
    const problems = await problemsWithFile(
      folder,
      '.devcontainer-internal.json',
      0,
    );
    await settledStatusOf(window, NO_SCHEMA);
    const status = await languageStatusOf(window);
    deepStrictEqual(
      [
        await isTrusted(window),
        status.item,
        status.menu.includes(NO_SCHEMA),
        problems.length,
      ],
      [false, 'JSON with Comments', true, 0],
    );
  });

  it('F-0810 AC-12 (c208-s294-untrusted): a devcontainers-contrib entry earns the same warning in the untrusted workspace, with no source', async () => {
    const folder = folderWithFile(
      'c208-s294-untrusted',
      '.devcontainer/devcontainer.json',
      CONTRIB,
    );
    const problems = await problemsWithFile(
      folder,
      '.devcontainer/devcontainer.json',
      1,
    );
    deepStrictEqual(
      [
        await isTrusted(window),
        problems.map(each => [
          each.file,
          each.message,
          each.severity,
          each.code,
          each.target,
          each.source,
        ]),
      ],
      [
        false,
        [
          [
            '.devcontainer/devcontainer.json',
            S294,
            'warning',
            'referencing-a-feature',
            REFERENCING,
            '',
          ],
        ],
      ],
    );
  });

  it('F-0810 AC-24 (c208-ac24): when the user trusts the workspace, the schema-download warning disappears and the validation proceeds with no problem', async () => {
    const folder = folderWithFile(
      'c208-ac24',
      'devcontainer-feature.json',
      VALID_FEATURE,
    );
    await problemsWithFile(folder, 'devcontainer-feature.json', 1);
    await setUserSetting('security.workspace.trust.untrustedFiles', ['**']);
    const settled = await trustSettled(window, true);
    let remaining: Problem[] = [];
    await waitFor(
      `no schema problem in window ${window}`,
      async () => {
        remaining = await problemsOf(window);
        return remaining.length === 0;
      },
      90_000,
    );
    await setUserSetting('security.workspace.trust.untrustedFiles', undefined);
    deepStrictEqual(
      [settled, remaining.length, await isTrusted(window)],
      [true, 0, true],
    );
  });
});
