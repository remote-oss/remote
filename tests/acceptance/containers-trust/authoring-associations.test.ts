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
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  clickButton,
  editorTabs,
  problemRows,
  problemsOf,
  type Problem,
  statusBarText,
  statusBarItemIds,
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

/** Clicks the language status item of window `name`'s status bar so that its hover shows. */
const OPEN_LANGUAGE_STATUS = `(() => {
  document.getElementById('status.languageStatus')
    ?.querySelector('a')
    ?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
  return true;
})()`;

/** The entries the language status hover shows, each as "label, detail" in the order shown. */
const LANGUAGE_STATUS_ENTRIES = `[...document.querySelectorAll('.hover-language-status .element .left')].map(left =>
  [...left.childNodes].map(part => (part.textContent ?? '').trim()).filter(part => part !== '').join(', '))`;

/** Closes the hovers of window `name`, so that the next read starts clean. */
const CLOSE_HOVERS = `(() => {
  for (const hover of document.querySelectorAll('.monaco-hover')) {
    hover.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  }
  return true;
})()`;

/** Waits until the language status of window `name` shows the entry `expected`, naming the state when it stops short. */
async function settledStatusOf(name: string, expected: string): Promise<void> {
  let state: {item: string; entries: string[]};
  const began = Date.now();
  for (;;) {
    state = await languageStatusOf(name);
    if (state.entries.includes(expected)) {
      return;
    }
    if (Date.now() - began > 90_000) {
      const itemIds = await statusBarItemIds(name);
      throw new Error(
        `window ${name}'s language status ${JSON.stringify(state.item)} shows entries ` +
          `${JSON.stringify(state.entries)}, without ${JSON.stringify(expected)}: ` +
          `status bar ids ${JSON.stringify(itemIds)}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/** The language mode of window `name`'s active editor with the entries of the status clicking it shows, read and closed. */
async function languageStatusOf(
  name: string,
): Promise<{item: string; entries: string[]}> {
  const item = await statusBarText(name, 'status.editor.mode');
  await evaluate<boolean>(name, OPEN_LANGUAGE_STATUS);
  let entries: string[] = [];
  const began = Date.now();
  while (entries.length === 0 && Date.now() - began < 15_000) {
    entries = await evaluate<string[]>(name, LANGUAGE_STATUS_ENTRIES);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await evaluate<boolean>(name, CLOSE_HOVERS);
  return {item, entries};
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

  /** The problems of window `name` once it holds `count` of them, naming what the window holds when it stops short. */
  async function problemsSettled(
    name: string,
    count: number,
    budget = 60_000,
  ): Promise<Problem[]> {
    let problems: Problem[];
    const began = Date.now();
    do {
      problems = await problemsOf(name);
      if (problems.length === count) {
        return problems;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() - began < budget);
    throw new Error(
      `window ${name} holds ${String(problems.length)} problems, not ${String(count)}: ` +
        `problems ${JSON.stringify(problems.map(each => [each.file, each.message, each.severity, each.line, each.code, each.source, each.target]))}, ` +
        `rows ${JSON.stringify(await problemRows(name))}, ` +
        `tabs ${JSON.stringify((await editorTabs(name)).map(each => each.label))}`,
    );
  }

  /** The problems of window `name` once one of them carries the message `message`, naming what the window holds when it stops short. */
  async function problemsIncluding(
    name: string,
    message: string,
    budget = 60_000,
  ): Promise<Problem[]> {
    let problems: Problem[];
    const began = Date.now();
    do {
      problems = await problemsOf(name);
      if (problems.some(each => each.message === message)) {
        return problems;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() - began < budget);
    throw new Error(
      `window ${name} holds no problem of ${JSON.stringify(message)}: ` +
        `problems ${JSON.stringify(problems.map(each => [each.file, each.message, each.severity, each.line, each.code, each.source, each.target]))}, ` +
        `rows ${JSON.stringify(await problemRows(name))}, ` +
        `tabs ${JSON.stringify((await editorTabs(name)).map(each => each.label))}`,
    );
  }

  /** Opens `file` of `folder` in a new window and gives the window and its problems once there are `count` of them. */
  async function problemsWithFile(
    folder: string,
    file: string,
    count: number,
  ): Promise<Problem[]> {
    window = await openFolderWindow(folder);
    await inWindow(window, 'acceptance.agent.openFile', file);
    return problemsSettled(window, count);
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
        status.entries.includes(NO_SCHEMA),
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
    window = await openFolderWindow(folder);
    await inWindow(
      window,
      'acceptance.agent.openFile',
      '.devcontainer/devcontainer.json',
    );
    const problems = await problemsIncluding(window, S294);
    deepStrictEqual(
      [
        await isTrusted(window),
        problems
          .filter(each => each.message === S294)
          .map(each => [
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
    window = await openFolderWindow(folder);
    await inWindow(
      window,
      'acceptance.agent.openFile',
      'devcontainer-feature.json',
    );
    await problemsIncluding(window, SCHEMA_BLOCKED);
    await inWindow(window, 'workbench.trust.manage');
    await waitFor(
      `window ${window}'s trust editor`,
      async () =>
        await evaluate<boolean>(
          window,
          `([...document.querySelectorAll('.editor-instance .monaco-button')].some(button => (button.textContent ?? '').trim() === 'Trust'))`,
        ),
      30_000,
    );
    // Granting trust takes effect in the window without a reload: the agent stays up, and the flip settles live.
    await clickButton(window, 'Trust');
    await trustSettled(window, true);
    const remaining = await problemsSettled(window, 0, 90_000);
    deepStrictEqual([remaining.length, await isTrusted(window)], [0, true]);
  });
});
