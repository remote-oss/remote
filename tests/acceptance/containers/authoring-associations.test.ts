import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  inWindow,
  isTrusted,
  variable,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  connectedWindow,
  openFolderWindow,
  openMemoryWindow,
  writeMemoryFile,
} from '../windows/folder-windows.ts';
import {
  editorTabs,
  problemRows,
  problemsOf,
  type Problem,
  statusBarText,
  statusBarItemIds,
  evaluate,
} from '../windows/renderer.ts';
import {docker} from '../windows/dev-containers-view.ts';

/** The code of the Feature-id problems, and the page its link opens. */
const REFERENCING =
  'https://containers.dev/implementors/features/#referencing-a-feature';

/** The text of STR:S294, on a `devcontainers-contrib` entry. */
const S294 =
  'Replace the reference to the discontinued `devcontainers-contrib` with `devcontainers-extra`';

/** The description the schema gives the `id` property. */
const ID_DESCRIPTION = 'ID of the Feature.';

/** The warning a file that misses `version` earns, beside the unknown property's. */
const MISSING_VERSION = 'Missing property "version".';
const UNKNOWN_PROPERTY = 'Property bogusProperty is not allowed.';

/** The words of the schema validation state, from the language status. */
const SCHEMA_VALIDATED = 'Schema validated, JSON schema configured';
const NO_SCHEMA = 'No schema validation, no JSON schema configured';

/** The valid metadata of a `devcontainer-feature.json`, with a comment that the jsonc mode must accept. */
const VALID_FEATURE =
  '{\n  // the metadata\n  "id": "remote-oss/probe",\n  "version": "1.0.0",\n  "name": "Probe",\n  "description": "A Feature that only probes."\n}\n';

/** A `devcontainer-feature.json` without the required `version`, with an unknown property. */
const INVALID_FEATURE =
  '{\n  // the metadata\n  "id": "remote-oss/probe",\n  "name": "Probe",\n  "bogusProperty": true\n}\n';

/** The `devcontainer.json` of a folder, with the entry of the discontinued namespace. */
function contribText(): string {
  return '{\n  "image": "alpine:3.22",\n  "features": {\n    "ghcr.io/devcontainers-contrib/features/curl-apt-get:1.0.0": {}\n  }\n}\n';
}

/** The folder `name` with `file` (relative to the folder's root) holding `text`. */
function folderWithFile(name: string, file: string, text: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  const target = path.join(folder, file);
  mkdirSync(path.dirname(target), {recursive: true});
  writeFileSync(target, text);
  return folder;
}

/** The text of the hover window `name`'s active editor shows at the token `needle`, empty when it shows none. */
async function editorHoverOf(name: string, needle: string): Promise<string> {
  // The cursor rests on the token read from the model, so a line the editor has not rendered yet is no obstacle; the
  // editor is focused first, since the command acts on the editor a preceding read may have unfocused.
  await inWindow(name, 'workbench.action.focusActiveEditorGroup');
  await inWindow(name, 'acceptance.agent.cursorOn', needle);
  let hover = '';
  for (let tries = 0; tries < 3 && hover === ''; tries += 1) {
    await inWindow(name, 'editor.action.showHover');
    for (let polls = 0; polls < 50 && hover === ''; polls += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      hover = (
        await evaluate<string>(
          name,
          `(() => {
            for (const open of document.querySelectorAll('.monaco-hover:not(.hidden)')) {
              // A hover the status bar holds, not the editor's: the editor's hover is the one that names its content.
              if (open.querySelector('.hover-language-status') !== null) {
                continue;
              }
              const text = open.querySelector('.monaco-hover-content')?.textContent ?? '';
              if (text !== '') {
                return text;
              }
            }
            return '';
          })()`,
        )
      ).trim();
    }
  }
  await evaluate<boolean>(name, CLOSE_HOVERS);
  return hover;
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

describe('the associations and the discontinued namespace of the authoring aids (card containers-208)', function () {
  this.timeout(600_000);
  const opened: string[] = [];
  afterEach(async () => {
    for (const window of opened.splice(0)) {
      await closeWindow(window);
    }
  });

  /** The base name of `file` and the same name without its last extension: the two forms the tab's label can take. */
  function tabLabels(file: string): string[] {
    const base = path.basename(file);
    const stripped = base.replace(/\.[^.]*$/, '');
    return stripped === base ? [base] : [base, stripped];
  }

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

  /** Opens `folder`, opens `file` in it, and gives the window and its problems once there are `count` of them. */
  async function problemsWithFile(
    folder: string,
    file: string,
    count: number,
  ): Promise<[string, Problem[]]> {
    const window = await openFolderWindow(folder);
    opened.push(window);
    await inWindow(window, 'acceptance.agent.openFile', file);
    const labels = tabLabels(file);
    const began = Date.now();
    for (;;) {
      const tabs = (await editorTabs(window)).map(each => each.label);
      if (tabs.some(each => labels.includes(each))) {
        return [window, await problemsSettled(window, count)];
      }
      if (Date.now() - began > 30_000) {
        throw new Error(
          `window ${window} shows no tab of ${JSON.stringify(file)}: ` +
            `tabs ${JSON.stringify(tabs)}`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  it('F-0810 AC-1 (c208-ac1): a devcontainer-feature.json with a comment opens as JSON with Comments, with no diagnostic', async () => {
    const folder = folderWithFile(
      'c208-ac1',
      'devcontainer-feature.json',
      VALID_FEATURE,
    );
    const [window] = await problemsWithFile(
      folder,
      'devcontainer-feature.json',
      0,
    );
    await settledStatusOf(window, SCHEMA_VALIDATED);
    deepStrictEqual(
      [
        (await languageStatusOf(window)).item,
        (await problemsOf(window)).length,
      ],
      ['JSON with Comments', 0],
    );
  });

  it('F-0810 AC-2 (c208-ac2): a valid devcontainer-feature.json validates with no problem against the schema, and its id property hovers the schema description', async () => {
    const folder = folderWithFile(
      'c208-ac2',
      'devcontainer-feature.json',
      VALID_FEATURE,
    );
    const [window] = await problemsWithFile(
      folder,
      'devcontainer-feature.json',
      0,
    );
    // The hover names the schema's description only once the schema the file points at has loaded, and a valid
    // file holds no problem until then, so the read retries for the description; the status bar's hover opens
    // only after the read, since its hover holds the window's hover slot and the editor's hover then shows none.
    let hover = '';
    const began = Date.now();
    for (;;) {
      hover = await editorHoverOf(window, '"id"');
      if (hover.includes(ID_DESCRIPTION) || Date.now() - began > 90_000) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    const count = (await problemsOf(window)).length;
    const status = await languageStatusOf(window);
    deepStrictEqual(
      [
        status.item,
        status.entries.includes(SCHEMA_VALIDATED),
        hover.includes(ID_DESCRIPTION),
        count,
      ],
      ['JSON with Comments', true, true, 0],
      `the hover ${JSON.stringify(hover)} at ${JSON.stringify(window)}`,
    );
  });

  it('F-0810 AC-12 (c208-s294): a devcontainers-contrib entry earns the warning over its whole entry, with its code link, no source and no quick fix, in a trusted window', async () => {
    const folder = folderWithFile(
      'c208-s294',
      '.devcontainer/devcontainer.json',
      contribText(),
    );
    const [window, problems] = await problemsWithFile(
      folder,
      '.devcontainer/devcontainer.json',
      1,
    );
    const hover = await editorHoverOf(window, 'devcontainers-contrib');
    deepStrictEqual(
      [
        problems.map(each => [
          each.file,
          each.message,
          each.severity,
          each.code,
          each.target,
          each.source,
        ]),
        hover.includes('No quick fixes available'),
      ],
      [
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
        true,
      ],
    );
  });

  it('F-0810 AC-4 (c208-ac4): a devcontainer-feature.json without its version, with an unknown property, earns the two schema warnings, with no quick fix', async () => {
    const folder = folderWithFile(
      'c208-ac4',
      'devcontainer-feature.json',
      INVALID_FEATURE,
    );
    const [window] = await problemsWithFile(
      folder,
      'devcontainer-feature.json',
      2,
    );
    const problems = await problemsOf(window);
    const hover = await editorHoverOf(window, 'bogusProperty');
    deepStrictEqual(
      [
        problems
          .map(each => [each.message, each.severity])
          .sort((left, right) =>
            String(left[0]).localeCompare(String(right[0])),
          ),
        hover.includes('No quick fixes available'),
      ],
      [
        [
          [MISSING_VERSION, 'warning'],
          [UNKNOWN_PROPERTY, 'warning'],
        ],
        true,
      ],
    );
  });

  it('F-0810 AC-5 (c208-ac5): a .devcontainer-internal.json with a comment and an arbitrary property earns no diagnostic, and the language status names no schema', async () => {
    const folder = folderWithFile(
      'c208-ac5',
      '.devcontainer-internal.json',
      '{\n  // the internal file\n  "bogusProperty": true\n}\n',
    );
    const [window] = await problemsWithFile(
      folder,
      '.devcontainer-internal.json',
      0,
    );
    await settledStatusOf(window, NO_SCHEMA);
    const status = await languageStatusOf(window);
    deepStrictEqual(
      [
        status.item,
        status.entries.includes(NO_SCHEMA),
        (await problemsOf(window)).length,
      ],
      ['JSON with Comments', true, 0],
    );
  });

  it('F-0810 AC-25 (c208-ac25-part): a devcontainer.json in a folder the specification does not recognize, with a discontinued entry, earns the same warning as the recognized places', async () => {
    const folder = folderWithFile(
      'c208-ac25',
      'devcontainer.json',
      '{\n  "features": {\n    "devcontainers-contrib/features/bash-command:1": {}\n  }\n}\n',
    );
    const [window] = await problemsWithFile(folder, 'devcontainer.json', 1);
    const problems = await problemsOf(window);
    deepStrictEqual(
      problems.map(each => [each.file, each.message, each.severity]),
      [['devcontainer.json', S294, 'warning']],
    );
  });

  it('F-0810 AC-42 (c208-ac42-memfs-part): the warning of the discontinued namespace shows in a virtual workspace window, on the document of the virtual scheme', async () => {
    const window = await openMemoryWindow();
    opened.push(window);
    await writeMemoryFile(window, '/devcontainer.json', contribText());
    await inWindow(
      window,
      'acceptance.agent.openUri',
      'memfs:/devcontainer.json',
    );
    let problems: Problem[];
    try {
      problems = await problemsSettled(window, 1, 120_000);
    } catch (caught) {
      await inWindow(
        window,
        'acceptance.agent.extensionPresent',
        'remote-oss.remote-containers',
      );
      const present = [...windowEvents(window)]
        .reverse()
        .find(
          each =>
            each.event === 'extension' &&
            each.extensionId === 'remote-oss.remote-containers',
        )?.present;
      throw new Error(
        `${String(caught)}; the Dev Containers extension present ${JSON.stringify(present)}`,
        {cause: caught},
      );
    }
    deepStrictEqual(
      problems.map(each => [each.file, each.message, each.severity]),
      [['devcontainer.json', S294, 'warning']],
    );
  });

  it('F-0810 AC-42 (c208-ac42-container-part): the warning shows in a dev container window for a configuration that exists only inside the container', async () => {
    const {name, containerId} = await connectedWindow('c208-ac42dc');
    opened.push(name);
    // The configuration lives in the container alone, outside the workspace mount the window opens from.
    const inContainer = '/tmp/c208-only/devcontainer.json';
    const text =
      '{"features": {"devcontainers-contrib/features/bash-command:1": {}}}';
    let problems: Problem[];
    try {
      await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        `mkdir -p /tmp/c208-only && printf '%s' '${text}' > ${inContainer}`,
      );
      // The container's own paths are the window's remote paths: the file is addressed by the window's authority,
      // the scheme and authority of the folder the window opened, not by a bare file uri.
      const folder = (await windowState(name)).folders[0];
      if (folder === undefined) {
        throw new Error(
          `window ${name} reports no folder to address ${inContainer} from`,
        );
      }
      const scheme = folder.slice(0, folder.indexOf('://'));
      const authority = folder.slice(
        folder.indexOf('://') + 3,
        folder.indexOf('/', folder.indexOf('://') + 3),
      );
      await inWindow(
        name,
        'acceptance.agent.openUri',
        `${scheme}://${authority}${inContainer}`,
      );
      problems = await problemsSettled(name, 1, 120_000);
    } catch (caught) {
      const state = await windowState(name);
      await inWindow(
        name,
        'acceptance.agent.extensionPresent',
        'remote-oss.remote-containers',
      );
      const present = [...windowEvents(name)]
        .reverse()
        .find(
          each =>
            each.event === 'extension' &&
            each.extensionId === 'remote-oss.remote-containers',
        )?.present;
      let listing: string;
      try {
        listing = await docker(
          'exec',
          containerId,
          'ls',
          '-la',
          '/tmp/c208-only',
        );
      } catch (listingFailure) {
        listing = `docker ls failed: ${String(listingFailure)}`;
      }
      throw new Error(
        `${String(caught)}; the window: remote ${JSON.stringify(state.remoteName)}, ` +
          `authority ${JSON.stringify(state.remoteAuthority)}, folders ${JSON.stringify(state.folders)}, ` +
          `tab ${JSON.stringify(state.activeTab?.uri ?? null)}, ` +
          `trusted ${JSON.stringify(await isTrusted(name))}, ` +
          `the Dev Containers extension present ${JSON.stringify(present)}, ` +
          `the container's ${inContainer} listed: ${JSON.stringify(listing)}`,
        {cause: caught},
      );
    }
    deepStrictEqual(
      [
        problems.map(each => [each.file, each.message, each.severity]),
        existsSync(
          path.join(
            variable('HARNESS_RUN_FOLDER'),
            'c208-ac42dc',
            'devcontainer.json',
          ),
        ),
      ],
      [[[inContainer, S294, 'warning']], false],
    );
  });

  it('F-0810 AC-43 (c208-ac43): changing the namespace of the flagged entry to devcontainers-extra in the buffer, without saving, removes the warning at once', async () => {
    const folder = folderWithFile(
      'c208-ac43',
      '.devcontainer/devcontainer.json',
      '{\n  "features": {\n    "ghcr.io/devcontainers-contrib/features/curl-apt-get:1.0.0": {}\n  }\n}\n',
    );
    const [window] = await problemsWithFile(
      folder,
      '.devcontainer/devcontainer.json',
      1,
    );
    await inWindow(
      window,
      'acceptance.agent.replaceInBuffer',
      'devcontainers-contrib',
      'devcontainers-extra',
    );
    const problems = await problemsSettled(window, 0, 30_000);
    await inWindow(window, 'workbench.action.revertAndCloseActiveEditor');
    deepStrictEqual(
      [
        problems.length,
        readFileSync(
          path.join(folder, '.devcontainer', 'devcontainer.json'),
          'utf8',
        ).includes('devcontainers-contrib'),
      ],
      [0, true],
    );
  });
});
