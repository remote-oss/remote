import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  connectedWindow,
  openFolderWindow,
  openMemoryWindow,
  writeMemoryFile,
} from '../windows/folder-windows.ts';
import {
  editorTabs,
  pressEscape,
  problemsOf,
  type Problem,
  statusBarText,
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

/** The text of the hover a mouse resting on `needle` in window `name`'s active editor shows, empty when none. */
async function editorHoverOf(name: string, needle: string): Promise<string> {
  await evaluate<boolean>(
    name,
    `(() => {
      const line = [...document.querySelectorAll('.view-lines .view-line')].find(
        entry => (entry.textContent ?? '').includes(${JSON.stringify(needle)}),
      );
      if (line === undefined) {
        return;
      }
      const text = line.textContent ?? '';
      const index = text.indexOf(${JSON.stringify(needle)});
      const nodeIterator = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let count = 0;
      let startNode: Text | null = null;
      let startOffset = 0;
      let endNode: Text | null = null;
      let endOffset = 0;
      let textNode: Node | null;
      while ((textNode = nodeIterator.nextNode()) !== null) {
        const length = textNode.nodeValue.length;
        if (startNode === null && count + length > index) {
          startNode = textNode as Text;
          startOffset = index - count;
        }
        if (endNode === null && count + length >= index + 1) {
          endNode = textNode as Text;
          endOffset = index + 1 - count;
          break;
        }
        count += length;
      }
      if (startNode === null || endNode === null) {
        return;
      }
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const rect = range.getBoundingClientRect();
      const point = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const target =
        document.elementFromPoint(point.x, point.y) ?? line;
      for (const type of ['mouseover', 'mousemove']) {
        target.dispatchEvent(
          new MouseEvent(type, {bubbles: true, clientX: point.x, clientY: point.y}),
        );
      }
      return true;
    })()`,
  );
  let hover = '';
  for (let tries = 0; tries < 40 && hover === ''; tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    hover = (
      await evaluate<string>(
        name,
        `(document.querySelector('.monaco-hover .monaco-hover-content, .workbench-hover')?.textContent ?? '')`,
      )
    ).trim();
  }
  return hover;
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

describe('the associations and the discontinued namespace of the authoring aids (card containers-208)', function () {
  this.timeout(600_000);
  const opened: string[] = [];
  afterEach(async () => {
    for (const window of opened.splice(0)) {
      await closeWindow(window);
    }
  });

  /** Opens `folder`, opens `file` in it, and gives the window and its problems once there are `count` of them. */
  async function problemsWithFile(
    folder: string,
    file: string,
    count: number,
  ): Promise<[string, Problem[]]> {
    const window = await openFolderWindow(folder);
    opened.push(window);
    await inWindow(window, 'acceptance.agent.openFile', file);
    await waitFor(
      `the file ${file} in an editor of window ${window}`,
      async () =>
        (await editorTabs(window)).some(entry => file.endsWith(entry.label)),
      30_000,
    );
    let problems: Problem[] = [];
    await waitFor(
      `${String(count)} problems in window ${window}`,
      async () => {
        problems = await problemsOf(window);
        return problems.length === count;
      },
      60_000,
    );
    return [window, problems];
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
    await settledStatusOf(window, SCHEMA_VALIDATED);
    const hover = await editorHoverOf(window, '"id"');
    const status = await languageStatusOf(window);
    deepStrictEqual(
      [
        status.item,
        status.menu.includes(SCHEMA_VALIDATED),
        hover.includes(ID_DESCRIPTION),
        (await problemsOf(window)).length,
      ],
      ['JSON with Comments', true, true, 0],
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
        status.menu.includes(NO_SCHEMA),
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
    let problems: Problem[] = [];
    await waitFor(
      `a problem in window ${window}`,
      async () => {
        problems = await problemsOf(window);
        return problems.length === 1;
      },
      60_000,
    );
    deepStrictEqual(
      problems.map(each => [each.file, each.message, each.severity]),
      [['devcontainer.json', S294, 'warning']],
    );
  });

  it('F-0810 AC-42 (c208-ac42-container-part): the warning shows in a dev container window for a configuration that exists only inside the container', async () => {
    const {name, containerId} = await connectedWindow('c208-ac42dc');
    opened.push(name);
    const text =
      '{"features": {"devcontainers-contrib/features/bash-command:1": {}}}';
    await docker(
      'exec',
      containerId,
      'sh',
      '-c',
      `printf '%s' '${text}' > /workspaces/c208-ac42dc/devcontainer.json`,
    );
    await inWindow(name, 'acceptance.agent.openFile', 'devcontainer.json');
    let problems: Problem[] = [];
    await waitFor(
      `a problem in window ${name}`,
      async () => {
        problems = await problemsOf(name);
        return problems.length === 1;
      },
      60_000,
    );
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
      [[['devcontainer.json', S294, 'warning']], false],
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
    let problems: Problem[] = [];
    await waitFor(
      'no problem in the window',
      async () => {
        problems = await problemsOf(window);
        return problems.length === 0;
      },
      30_000,
    );
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
