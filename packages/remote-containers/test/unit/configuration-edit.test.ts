import {deepStrictEqual} from 'node:assert';
import {
  applyConfigurationEdit,
  type ConfigUri,
  type ConfigurationEditPorts,
  type EditPolicy,
  type EditResult,
  type TextChange,
} from '../../src/config/configuration-edit.ts';
import {NotAnObjectError} from '../../src/config/jsonc-edit.ts';
import {
  type FakeEditor,
  fakePortsOf,
  uriOf,
} from './configuration-edit.fixture.ts';

const FILE = uriOf('/work/proj/.devcontainer/devcontainer.json');
const OBJECT = '{\n  "a": 1\n}';

interface Scene {
  ports: ConfigurationEditPorts;
  log: string[];
}

/** Fake editor ports. `tab` is the document some tab holds for the file, and `disk` what the file system holds. */
function sceneOf(
  options: Omit<FakeEditor, 'files' | 'tabs'> & {
    tab?: {text: string; dirty: boolean};
    disk?: string;
  } = {},
): Scene {
  return fakePortsOf({
    ...options,
    files: options.disk === undefined ? {} : {[FILE.fsPath]: options.disk},
    tabs: options.tab === undefined ? {} : {[FILE.fsPath]: options.tab},
  });
}

const APPEND: TextChange = current => `${current}!`;

async function resultsOf(
  policy: EditPolicy,
  options: Parameters<typeof sceneOf>[0],
  change: TextChange = APPEND,
  file: ConfigUri = FILE,
): Promise<{result: EditResult; log: string[]}> {
  const scene = sceneOf(options);
  const result = await applyConfigurationEdit(
    file,
    change,
    policy,
    scene.ports,
  );
  return {result, log: scene.log};
}

describe('the document-edit seam (card containers-206, brief-authoring-edits §2)', () => {
  it('F-0809 BR-6 (c206-buffer): the buffer policy opens a document nobody holds and edits it, and edits an open one, and never saves', async () => {
    const closed = await resultsOf('buffer', {disk: OBJECT});
    const open = await resultsOf('buffer', {tab: {text: OBJECT, dirty: true}});
    deepStrictEqual(
      [closed, open],
      [
        {
          result: {kind: 'inBuffer', durable: false},
          log: [
            `open ${FILE.fsPath}`,
            `edit ${FILE.fsPath} ${JSON.stringify(`${OBJECT}!`)}`,
          ],
        },
        {
          result: {kind: 'inBuffer', durable: false},
          log: [`edit ${FILE.fsPath} ${JSON.stringify(`${OBJECT}!`)}`],
        },
      ],
    );
  });

  it('F-0809 BR-3 (c206-current-text): the change reads the open buffer’s text when a tab holds the file, and the disk’s when none does', async () => {
    const seen: string[] = [];
    function note(current: string): undefined {
      seen.push(current);
      return undefined;
    }
    await resultsOf(
      'buffer',
      {tab: {text: 'buffer', dirty: true}, disk: 'disk'},
      note,
    );
    await resultsOf(
      'diskUnlessOpen',
      {tab: {text: 'buffer', dirty: true}, disk: 'disk'},
      note,
    );
    await resultsOf('diskUnlessOpen', {disk: 'disk'}, note);
    await resultsOf(
      'diskOrSaveIfClean',
      {tab: {text: '{}', dirty: true}, disk: 'disk'},
      note,
    );
    deepStrictEqual(seen, ['buffer', 'buffer', 'disk', '{}']);
  });

  it('F-0809 BR-6 (c206-unchanged): a change that gives no text is unchanged for every policy, and nothing is edited, written or saved', async () => {
    const nothing: TextChange = () => undefined;
    const outcomes = [
      await resultsOf('buffer', {disk: OBJECT}, nothing),
      await resultsOf('diskUnlessOpen', {disk: OBJECT}, nothing),
      await resultsOf(
        'diskUnlessOpen',
        {tab: {text: OBJECT, dirty: false}},
        nothing,
      ),
      await resultsOf('diskOrSaveIfClean', {disk: OBJECT}, nothing),
    ];
    deepStrictEqual(
      outcomes.map(outcome => [
        outcome.result,
        outcome.log.filter(line => /^(edit|save|write|rename)/.test(line)),
      ]),
      Array<unknown>(4).fill([{kind: 'unchanged'}, []]),
    );
  });

  it('F-0809 BR-7 (c206-disk-unless-open): a file no tab holds is written under a temporary name in its own folder and renamed over it; a tab holding it is edited in the buffer', async () => {
    const closed = await resultsOf('diskUnlessOpen', {disk: OBJECT});
    const open = await resultsOf('diskUnlessOpen', {
      tab: {text: OBJECT, dirty: false},
    });
    const folder = '/work/proj/.devcontainer';
    deepStrictEqual(
      [closed, open],
      [
        {
          result: {kind: 'written', durable: true},
          log: [
            `read ${FILE.fsPath}`,
            `write ${folder}/.u1.tmp ${JSON.stringify(`${OBJECT}!`)}`,
            `rename ${folder}/.u1.tmp ${FILE.fsPath}`,
          ],
        },
        {
          result: {kind: 'inBuffer', durable: false},
          log: [`edit ${FILE.fsPath} ${JSON.stringify(`${OBJECT}!`)}`],
        },
      ],
    );
  });

  it('F-0809 BR-7 (c206-disk-new-file): a file that does not exist yet starts from empty text, and a rename that fails removes the temporary file and fails', async () => {
    const fresh = await resultsOf(
      'diskUnlessOpen',
      {},
      current => `[${current}]`,
    );
    let failure = '';
    const scene = sceneOf({disk: OBJECT, renameFails: true});
    try {
      await applyConfigurationEdit(FILE, APPEND, 'diskUnlessOpen', scene.ports);
    } catch (caught) {
      failure = (caught as Error).message;
    }
    deepStrictEqual(
      [fresh.result, fresh.log[0], failure, scene.log.at(-1)],
      [
        {kind: 'written', durable: true},
        'write /work/proj/.devcontainer/.u1.tmp "[]"',
        'EXDEV',
        'delete /work/proj/.devcontainer/.u1.tmp',
      ],
    );
  });

  it('F-1103 AC-24, AC-25 (c206-save-if-clean): a dirty tab is edited in the buffer and not saved; a clean tab, and a file no tab holds, are edited through the editor and saved', async () => {
    const dirty = await resultsOf('diskOrSaveIfClean', {
      tab: {text: OBJECT, dirty: true},
    });
    const clean = await resultsOf('diskOrSaveIfClean', {
      tab: {text: OBJECT, dirty: false},
    });
    const none = await resultsOf('diskOrSaveIfClean', {disk: OBJECT});
    const edit = `edit ${FILE.fsPath} ${JSON.stringify(`${OBJECT}!`)}`;
    deepStrictEqual(
      [dirty, clean, none],
      [
        {result: {kind: 'inBuffer', durable: false}, log: [edit]},
        {
          result: {kind: 'saved', durable: true},
          log: [edit, `save ${FILE.fsPath}`],
        },
        {
          result: {kind: 'saved', durable: true},
          log: [`open ${FILE.fsPath}`, edit, `save ${FILE.fsPath}`],
        },
      ],
    );
  });

  it('F-1103 AC-24 (c206-never-rename): the save-if-clean policy writes no temporary file and renames nothing, in any tab state', async () => {
    const states = [
      {tab: {text: OBJECT, dirty: true}},
      {tab: {text: OBJECT, dirty: false}},
      {disk: OBJECT},
    ];
    const logs: string[] = [];
    for (const state of states) {
      logs.push(...(await resultsOf('diskOrSaveIfClean', state)).log);
    }
    deepStrictEqual(
      logs.filter(line => /^(write|rename|delete)/.test(line)),
      [],
    );
  });

  it('F-0809 (c206-guard-link): a file whose real path is outside the workspace folders is refused through a link, and nothing is edited or saved; a link that stays inside works', async () => {
    const outside = await resultsOf('diskOrSaveIfClean', {
      disk: OBJECT,
      realPaths: {[FILE.fsPath]: '/home/other/secret.json'},
    });
    const inside = await resultsOf('diskOrSaveIfClean', {
      disk: OBJECT,
      realPaths: {[FILE.fsPath]: '/work/proj/shared/dev.json'},
    });
    const folderLinked = await resultsOf('diskOrSaveIfClean', {
      disk: OBJECT,
      realPaths: {
        '/work/proj': '/mnt/real/proj',
        [FILE.fsPath]: '/mnt/real/proj/.devcontainer/devcontainer.json',
      },
    });
    const noFolders = await resultsOf('diskOrSaveIfClean', {
      disk: OBJECT,
      folders: [],
    });
    deepStrictEqual(
      [outside, inside.result, folderLinked.result, noFolders].map(each =>
        'log' in each
          ? [each.result, each.log.filter(line => /^(edit|save)/.test(line))]
          : each,
      ),
      [
        [{kind: 'refused', reason: 'outsideWorkspace'}, []],
        {kind: 'saved', durable: true},
        {kind: 'saved', durable: true},
        [{kind: 'refused', reason: 'outsideWorkspace'}, []],
      ],
    );
  });

  it('F-0809 (c206-guard-first): the guard runs before the document is opened or read, so a refused file is never opened', async () => {
    const outside = await resultsOf('diskOrSaveIfClean', {
      disk: OBJECT,
      realPaths: {[FILE.fsPath]: '/home/other/secret.json'},
    });
    const linked = await resultsOf(
      'diskOrSaveIfClean',
      {disk: OBJECT, linkSchemes: true},
      APPEND,
      uriOf(FILE.fsPath, 'vscode-remote'),
    );
    deepStrictEqual(
      [outside, linked].map(each => [
        each.result,
        each.log.filter(line => /^(open|read)/.test(line)),
      ]),
      [
        [{kind: 'refused', reason: 'outsideWorkspace'}, []],
        [{kind: 'refused', reason: 'symbolicLink'}, []],
      ],
    );
  });

  it('F-0809 (c206-guard-folders): a workspace folder of another scheme is skipped, and its real path is not asked for', async () => {
    const result = await resultsOf('diskOrSaveIfClean', {
      disk: OBJECT,
      folders: [uriOf('/work/proj', 'vscode-remote'), uriOf('/work/proj')],
      logRealPaths: true,
    });
    deepStrictEqual(
      [result.result, result.log.filter(line => line.startsWith('realPath'))],
      [
        {kind: 'saved', durable: true},
        [`realPath file:${FILE.fsPath}`, 'realPath file:/work/proj'],
      ],
    );
  });

  it('F-0809 (c206-guard-scheme): a file of another scheme is refused when it is a symbolic link, and edited when it is not', async () => {
    const remote = uriOf(
      '/work/proj/.devcontainer/devcontainer.json',
      'vscode-remote',
    );
    const linked = await resultsOf(
      'diskOrSaveIfClean',
      {disk: OBJECT, linkSchemes: true},
      APPEND,
      remote,
    );
    const plain = await resultsOf(
      'diskOrSaveIfClean',
      {disk: OBJECT},
      APPEND,
      remote,
    );
    deepStrictEqual(
      [
        linked.result,
        linked.log.filter(line => /^(edit|save)/.test(line)),
        plain.result,
      ],
      [
        {kind: 'refused', reason: 'symbolicLink'},
        [],
        {kind: 'saved', durable: true},
      ],
    );
  });

  it('F-0809 (c206-guard-object): a text that is not a JSON object is refused before a save, and so is a change that throws NotAnObjectError', async () => {
    const array = await resultsOf('diskOrSaveIfClean', {disk: '[]'});
    const broken = await resultsOf('diskOrSaveIfClean', {disk: 'nope'});
    const thrown = await resultsOf('diskOrSaveIfClean', {disk: OBJECT}, () => {
      throw new NotAnObjectError();
    });
    const thrownOnDisk = await resultsOf(
      'diskUnlessOpen',
      {disk: OBJECT},
      () => {
        throw new NotAnObjectError();
      },
    );
    deepStrictEqual(
      [array, broken, thrown, thrownOnDisk].map(each => [
        each.result,
        each.log.filter(line => /^(edit|save|write|rename)/.test(line)),
      ]),
      Array<unknown>(4).fill([{kind: 'refused', reason: 'notAnObject'}, []]),
    );
  });

  it('F-0809 (c206-other-errors): an error that is not NotAnObjectError reaches the caller', async () => {
    let message = '';
    try {
      await resultsOf('buffer', {disk: OBJECT}, () => {
        throw new Error('boom');
      });
    } catch (caught) {
      message = (caught as Error).message;
    }
    deepStrictEqual(message, 'boom');
  });
});
