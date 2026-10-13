import {deepStrictEqual, rejects} from 'node:assert';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {FileChoice, FileChoiceItem} from '../../src/config/file-choice.ts';
import {buildFileChoice} from '../../src/config/file-choice.ts';
import {starterTemplate} from '../../src/config/new-file.ts';
import {
  configFileEditorOf,
  nodeConfigFiles,
} from '../../src/config/config-file-editor.ts';
import {filePickPortOf} from '../../src/surfaces/editor-adapters.ts';
import {FakeQuickPick} from './editor-fakes.fixture.ts';

type Editor = Parameters<typeof configFileEditorOf>[0];

/** A snippet the adapter built, with the text it holds, as the editor's own builder would write it. */
class FakeSnippet {
  value = '';

  appendText(text: string): this {
    this.value += text.replace(/[\\$}]/g, match => `\\${match}`);
    return this;
  }

  appendPlaceholder(text: string, number: number): this {
    this.value += `\${${String(number)}:${text}}`;
    return this;
  }

  appendTabstop(number: number): this {
    this.value += `$${String(number)}`;
    return this;
  }
}

interface FakeTextEditor {
  document: {uri: {fsPath: string}};
  inserted: Array<{
    snippet: FakeSnippet;
    place: {line: number; character: number};
  }>;
  insertSnippet(
    snippet: FakeSnippet,
    place: {line: number; character: number},
  ): Promise<boolean>;
}

function fakeEditor() {
  const picks: FakeQuickPick[] = [];
  const shownDocuments: Array<{uri: {fsPath: string}; options: unknown}> = [];
  const editors: FakeTextEditor[] = [];
  const editor = {
    window: {
      createQuickPick: () => {
        const pick = new FakeQuickPick();
        picks.push(pick);
        return pick;
      },
      showTextDocument: (uri: {fsPath: string}, options: unknown) => {
        shownDocuments.push({uri, options});
        const shown = textEditorFor(uri.fsPath);
        editors.push(shown);
        return Promise.resolve(shown);
      },
    },
    ['Uri']: {file: (fsPath: string) => ({fsPath})},
    Position: class {
      line: number;
      character: number;

      constructor(line: number, character: number) {
        this.line = line;
        this.character = character;
      }
    },
    SnippetString: FakeSnippet,
  } as unknown as Editor;
  return {editor, picks, shownDocuments, editors};
}

function textEditorFor(file: string): FakeTextEditor {
  const made: FakeTextEditor = {
    document: {uri: {fsPath: file}},
    inserted: [],
    insertSnippet: (snippet, place) => {
      made.inserted.push({snippet, place});
      return Promise.resolve(true);
    },
  };
  return made;
}

function translated(template: string): string {
  return `<${template}>`;
}

const CHOICE: FileChoice = buildFileChoice({
  configFile: '',
  userFile: '/h/.ssh/config',
  systemFile: '/etc/ssh/ssh_config',
});

describe('the editor adapter of the Open SSH Configuration File command (card remote-ssh-19)', () => {
  function pickShown(fake: ReturnType<typeof fakeEditor>) {
    const result = configFileEditorOf(
      fake.editor,
      filePickPortOf(fake.editor, translated),
    ).pickFile(CHOICE);
    const [pick] = fake.picks;
    if (pick === undefined) {
      throw new Error('no quick pick was created');
    }
    return {result, pick};
  }

  it('F-2203 AC-2: the placeholder is translated and the rows are shown in order without a title', () => {
    const {pick} = pickShown(fakeEditor());
    deepStrictEqual(
      [pick.placeholder, pick.items.map(item => item.label), pick.title],
      [
        '<Select SSH configuration file to update>',
        ['/h/.ssh/config', '/etc/ssh/ssh_config', '<Settings>', '<Help>'],
        undefined,
      ],
    );
  });

  it('F-2203 AC-2: the fixed rows carry their descriptions and are always shown', () => {
    const {pick} = pickShown(fakeEditor());
    deepStrictEqual(
      pick.items.map(item => [item.description, item.alwaysShow]),
      [
        [undefined, undefined],
        [undefined, undefined],
        ['<specify a custom configuration file>', true],
        ['<about SSH configuration files>', true],
      ],
    );
  });

  it('F-2203 AC-28: the pick stays open when the focus moves away, with one selection and the first row focused', () => {
    const {pick} = pickShown(fakeEditor());
    deepStrictEqual(
      [
        pick.ignoreFocusOut,
        pick.canSelectMany,
        pick.activeItems.map(item => item.label),
        pick.shown,
      ],
      [true, false, ['/h/.ssh/config'], 1],
    );
  });

  it('F-2203 5.0 step 3: accepting a row gives the row of the model', async () => {
    const {result, pick} = pickShown(fakeEditor());
    const second = pick.items[1];
    if (second === undefined) {
      throw new Error('no second row');
    }
    pick.accept(second);
    const expected: FileChoiceItem | undefined = CHOICE.items[1];
    deepStrictEqual(await result, expected);
  });

  it('F-2203 6.6: hidden without accepting gives nothing and disposes the pick', async () => {
    const {result, pick} = pickShown(fakeEditor());
    pick.hide();
    deepStrictEqual([await result, pick.disposals], [undefined, 1]);
  });

  it('F-2203 BR-7: opening a file shows its document as a preview', async () => {
    const fake = fakeEditor();
    await configFileEditorOf(
      fake.editor,
      filePickPortOf(fake.editor, translated),
    ).open('/h/.ssh/config');
    deepStrictEqual(fake.shownDocuments, [
      {uri: {fsPath: '/h/.ssh/config'}, options: {preview: true}},
    ]);
  });

  it('#408 (2): open gives back the editor showTextDocument showed', async () => {
    const fake = fakeEditor();
    const opened = (await configFileEditorOf(
      fake.editor,
      filePickPortOf(fake.editor, translated),
    ).open('/h/.ssh/config')) as {file: string; editor: unknown};
    const [shown] = fake.editors;
    deepStrictEqual(
      [opened.file, opened.editor === shown],
      ['/h/.ssh/config', true],
    );
  });

  it('#408 (2): the template goes into the editor open gave, and no visible editor is needed', async () => {
    const target = textEditorFor('/h/.ssh/config');
    const fake = fakeEditor();
    const opened = {file: '/h/.ssh/config', editor: target};
    await configFileEditorOf(
      fake.editor,
      filePickPortOf(fake.editor, translated),
    ).insertTemplate(opened, starterTemplate({insertSpaces: true, tabSize: 4}));
    deepStrictEqual(
      target.inserted.map(entry => [
        entry.snippet.value,
        {line: entry.place.line, character: entry.place.character},
      ]),
      [
        [
          '# Read more about SSH config files: https://linux.die.net/man/5/ssh_config\nHost ${1:alias}\n    HostName ${2:hostname}\n    User ${3:user}$0',
          {line: 0, character: 0},
        ],
      ],
    );
  });
});

describe('the client files of the Open SSH Configuration File command (card remote-ssh-19)', () => {
  let root: string;
  let previousMask: number;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'config-files-'));
    previousMask = process.umask(0o022);
  });

  afterEach(() => {
    process.umask(previousMask);
    rmSync(root, {recursive: true, force: true});
  });

  function modeOf(file: string): number {
    return statSync(file).mode & 0o777;
  }

  it('F-2203 AC-5: a folder and a file are made with the modes asked, whatever the umask', async () => {
    const folder = path.join(root, '.ssh');
    const file = path.join(folder, 'config');
    await nodeConfigFiles.makeFolder(folder, 0o700);
    await nodeConfigFiles.createFile(file, 0o600);
    deepStrictEqual([modeOf(folder), modeOf(file)], [0o700, 0o600]);
  });

  it('F-2203 AC-5: modes more open than the umask allows are still made as asked', async () => {
    process.umask(0o077);
    const folder = path.join(root, 'open');
    const file = path.join(folder, 'config');
    await nodeConfigFiles.makeFolder(folder, 0o755);
    await nodeConfigFiles.createFile(file, 0o644);
    deepStrictEqual([modeOf(folder), modeOf(file)], [0o755, 0o644]);
  });

  it('F-2203 AC-31: a file whose folder exists has no missing folder', async () => {
    deepStrictEqual(
      await nodeConfigFiles.missingFolders(path.join(root, 'config')),
      [],
    );
  });

  it('F-2203 AC-12: the missing folders on the path are listed outermost first', async () => {
    deepStrictEqual(
      await nodeConfigFiles.missingFolders(path.join(root, 'a', 'b', 'f')),
      [path.join(root, 'a'), path.join(root, 'a', 'b')],
    );
  });

  it('F-2203 AC-3: a file that exists is found, and one that does not is not', async () => {
    const file = path.join(root, 'there');
    writeFileSync(file, '');
    deepStrictEqual(
      [
        await nodeConfigFiles.exists(file),
        await nodeConfigFiles.exists(path.join(root, 'absent')),
      ],
      [true, false],
    );
  });

  it('F-2203 AC-21: a file under a regular file cannot be created, with the system error', async () => {
    const blocker = path.join(root, 'blocker');
    writeFileSync(blocker, '');
    await rejects(
      Promise.resolve(
        nodeConfigFiles.createFile(path.join(blocker, 'f'), 0o600),
      ),
      {
        code: 'ENOTDIR',
      },
    );
  });

  it('F-2203 AC-9: a file that exists is not created again and is left as it is', async () => {
    const file = path.join(root, 'kept');
    writeFileSync(file, 'keep me');
    await Promise.resolve(nodeConfigFiles.createFile(file, 0o600)).catch(
      () => undefined,
    );
    deepStrictEqual(readFileSync(file, 'utf8'), 'keep me');
  });

  it('F-2203 AC-9: creating a file that exists fails', async () => {
    const file = path.join(root, 'kept');
    writeFileSync(file, '');
    await rejects(Promise.resolve(nodeConfigFiles.createFile(file, 0o600)), {
      code: 'EEXIST',
    });
  });

  it('F-2203 AC-21: a folder that cannot be made rejects with the system error (skipped when run as root)', async function () {
    if (process.getuid?.() === 0) {
      this.skip();
    }
    const readOnly = path.join(root, 'read-only');
    mkdirSync(readOnly);
    chmodSync(readOnly, 0o555);
    try {
      await rejects(
        Promise.resolve(
          nodeConfigFiles.makeFolder(path.join(readOnly, 'inner'), 0o700),
        ),
        {code: 'EACCES'},
      );
    } finally {
      chmodSync(readOnly, 0o755);
    }
  });
});
