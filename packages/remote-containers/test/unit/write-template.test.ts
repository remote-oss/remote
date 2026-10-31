import {deepStrictEqual} from 'node:assert';
import type {ApplyTemplateResult} from '../../src/cli/cli-lines.ts';
import {
  type EntryKind,
  type WritePorts,
  type WriteRequest,
  writeTemplate,
} from '../../src/authoring/write.ts';

const NEVER = new AbortController().signal;
const TARGET = '/work/ws';
const SCRATCH = '/store/authoring-scratch/abc';

const REQUEST: WriteRequest = {
  targetFolder: TARGET,
  templateId: 'ghcr.io/devcontainers/templates/alpine',
  templateArgs: {imageVariant: '3.20'},
  features: [],
  omitPaths: [],
};

/** The world of one write: the files, the answers and what the write did. */
class Scene {
  /** The files of the target, by absolute path. */
  target = new Map<string, string>();
  /** The folders of the target that exist. */
  folders = new Set<string>([TARGET]);
  /** What the CLI gives and the files it leaves in the scratch folder. */
  applied: ApplyTemplateResult = {kind: 'applied', files: []};
  scratchFiles = new Map<string, string>();
  /** The answers to the modals, in order; Escape when out. */
  answers: Array<string | undefined> = [];
  unsaved = new Set<string>();
  problems = new Map<string, string>();
  writeError: Error | undefined;
  /** The nth write (counting from 1) fails, the first when unset. */
  failAt: number | undefined;
  removeError: Error | undefined;
  shown: Array<{
    severity: string;
    message: string;
    detail: string;
    buttons: readonly string[];
  }> = [];
  written: string[] = [];
  removed: string[] = [];
  logged: string[] = [];
  titles: string[] = [];
  logRevealed = 0;
  applyRequests: unknown[] = [];
  attempts = 0;

  ports(): WritePorts {
    return {
      applyTemplate: (request, onLine) => {
        this.applyRequests.push(request);
        onLine('a line of stderr');
        return Promise.resolve(this.applied);
      },
      files: {
        makeScratchFolder: () => Promise.resolve(SCRATCH),
        kindOf: (file): Promise<EntryKind> => {
          if (this.target.has(file)) {
            return Promise.resolve('file');
          }
          return Promise.resolve(this.folders.has(file) ? 'folder' : 'missing');
        },
        read: file => {
          const content = file.startsWith(`${SCRATCH}/`)
            ? this.scratchFiles.get(file.slice(SCRATCH.length + 1))
            : this.target.get(file);
          return Promise.resolve(new TextEncoder().encode(content ?? ''));
        },
        write: (file, bytes) => {
          this.attempts += 1;
          if (
            this.writeError !== undefined &&
            this.attempts === (this.failAt ?? 1)
          ) {
            return Promise.reject(this.writeError);
          }
          this.target.set(file, new TextDecoder().decode(bytes));
          this.written.push(file);
          return Promise.resolve();
        },
        makeFolder: folder => {
          this.folders.add(folder);
          return Promise.resolve();
        },
        removeFile: file => {
          if (this.removeError !== undefined) {
            return Promise.reject(this.removeError);
          }
          this.target.delete(file);
          return Promise.resolve();
        },
        removeFolder: folder => {
          this.removed.push(folder);
          for (const each of [...this.folders]) {
            if (each === folder || each.startsWith(`${folder}/`)) {
              this.folders.delete(each);
            }
          }
          return Promise.resolve();
        },
        creationProblem: folder => Promise.resolve(this.problems.get(folder)),
      },
      dialogs: {
        show: (severity, message, detail, buttons) => {
          this.shown.push({severity, message, detail, buttons});
          return Promise.resolve(this.answers.shift());
        },
        revealLog: () => {
          this.logRevealed += 1;
        },
      },
      hasUnsavedChanges: file => this.unsaved.has(file),
      withProgress: (title, work) => {
        this.titles.push(title);
        return work();
      },
      logLine: line => {
        this.logged.push(line);
      },
      translate: template => template,
    };
  }

  /** Runs the write over this scene. */
  execute(
    adjust?: WriteRequest['adjust'],
    displayPath?: WriteRequest['displayPath'],
  ): ReturnType<typeof writeTemplate> {
    return writeTemplate(
      {
        ...REQUEST,
        ...(adjust === undefined ? {} : {adjust}),
        ...(displayPath === undefined ? {} : {displayPath}),
      },
      this.ports(),
      NEVER,
    );
  }

  /** The CLI leaves these files in the scratch folder and reports them. */
  leaves(...relatives: string[]): void {
    this.applied = {kind: 'applied', files: relatives.map(each => `./${each}`)};
    for (const relative of relatives) {
      this.scratchFiles.set(relative, `new ${relative}`);
    }
  }
}

describe('the write of a template (card containers-78)', () => {
  it('F-0801 AC-4: the files are copied into the target, folders first, and the outcome names them; the progress shows for the whole call', async () => {
    const scene = new Scene();
    scene.leaves('.devcontainer/devcontainer.json', '.github/dependabot.yml');
    const outcome = await scene.execute();
    deepStrictEqual(
      [
        outcome,
        [...scene.target.entries()],
        scene.titles,
        scene.shown.length,
        scene.logged,
        scene.applyRequests,
      ],
      [
        {
          kind: 'written',
          files: ['.devcontainer/devcontainer.json', '.github/dependabot.yml'],
        },
        [
          [
            `${TARGET}/.devcontainer/devcontainer.json`,
            'new .devcontainer/devcontainer.json',
          ],
          [`${TARGET}/.github/dependabot.yml`, 'new .github/dependabot.yml'],
        ],
        ['Adding Dev Container Configuration Files...'],
        0,
        ['a line of stderr'],
        [
          {
            workspaceFolder: SCRATCH,
            templateId: REQUEST.templateId,
            templateArgs: REQUEST.templateArgs,
            features: [],
            omitPaths: [],
          },
        ],
      ],
    );
  });

  it('F-0801 AC-9, BR-6: an existing file is asked about with the three buttons, and Overwrite replaces it', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/.devcontainer/devcontainer.json`, 'old');
    scene.leaves('.devcontainer/devcontainer.json');
    scene.answers = ['Overwrite'];
    const outcome = await scene.execute();
    deepStrictEqual(
      [
        outcome.kind,
        scene.shown,
        scene.target.get(`${TARGET}/.devcontainer/devcontainer.json`),
      ],
      [
        'written',
        [
          {
            severity: 'info',
            message:
              "File './.devcontainer/devcontainer.json' already exists, overwrite?",
            detail: '',
            buttons: ['Skip', 'Overwrite', 'Cancel'],
          },
        ],
        'new .devcontainer/devcontainer.json',
      ],
    );
  });

  it('F-0302 AC-35: the question names the file as the request’s display path gives it', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/a.txt`, 'old');
    scene.leaves('a.txt');
    scene.answers = ['Skip'];
    await scene.execute(undefined, relative => `~/store/${relative}`);
    deepStrictEqual(
      scene.shown.map(each => each.message),
      ["File '~/store/a.txt' already exists, overwrite?"],
    );
  });

  it('F-0801 AC-9: Skip leaves the file as it is and the others are written', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/a.txt`, 'old a');
    scene.leaves('a.txt', 'b.txt');
    scene.answers = ['Skip'];
    deepStrictEqual(
      [
        await scene.execute(),
        scene.target.get(`${TARGET}/a.txt`),
        scene.target.get(`${TARGET}/b.txt`),
      ],
      [{kind: 'written', files: ['b.txt']}, 'old a', 'new b.txt'],
    );
  });

  it('F-0801 AC-9, 7.E2: Cancel and Escape cancel the write with nothing written, after every question was asked first', async () => {
    const outcomes: Array<[string, number, number]> = [];
    for (const answer of ['Cancel', undefined]) {
      const scene = new Scene();
      scene.target.set(`${TARGET}/a.txt`, 'old a');
      scene.target.set(`${TARGET}/c.txt`, 'old c');
      scene.leaves('a.txt', 'b.txt', 'c.txt');
      scene.answers = ['Overwrite', answer];
      const outcome = await scene.execute();
      outcomes.push([outcome.kind, scene.written.length, scene.shown.length]);
    }
    deepStrictEqual(outcomes, [
      ['cancelled', 0, 2],
      ['cancelled', 0, 2],
    ]);
  });

  it('F-0801 AC-39, 7.E11: a file with unsaved changes in an editor has that line in the dialog’s detail', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/a.txt`, 'old a');
    scene.target.set(`${TARGET}/b.txt`, 'old b');
    scene.unsaved.add(`${TARGET}/a.txt`);
    scene.leaves('a.txt', 'b.txt');
    scene.answers = ['Skip', 'Skip'];
    await scene.execute();
    deepStrictEqual(
      scene.shown.map(each => each.detail),
      ['It has unsaved changes in an editor.', ''],
    );
  });

  it('F-0801 AC-38, BR-5: the files of the target that the template does not write stay byte for byte', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/keep.md`, 'mine');
    scene.leaves('new.txt');
    await scene.execute();
    deepStrictEqual(
      [scene.target.get(`${TARGET}/keep.md`), scene.removed],
      ['mine', [SCRATCH]],
    );
  });

  it('F-0801 AC-30, 7.E8: a folder the copy needs that cannot be made fails the write before anything is written, with our own message', async () => {
    const scene = new Scene();
    scene.leaves('a.txt', '.devcontainer/devcontainer.json');
    scene.problems.set(
      `${TARGET}/.devcontainer`,
      "ENOTDIR: not a directory, mkdir '/work/ws/.devcontainer'",
    );
    const outcome = await scene.execute();
    deepStrictEqual(
      [outcome, scene.written, scene.shown],
      [
        {
          kind: 'failed',
          detail: "ENOTDIR: not a directory, mkdir '/work/ws/.devcontainer'",
        },
        [],
        [
          {
            severity: 'error',
            message:
              "The configuration couldn't be written to /work/ws: ENOTDIR: not a directory, mkdir '/work/ws/.devcontainer'",
            detail: '',
            buttons: [],
          },
        ],
      ],
    );
  });

  it('F-0801 7.E8: a write that fails midway fails the write with the file system’s message and the dialog of ours', async () => {
    const scene = new Scene();
    scene.leaves('a.txt');
    scene.writeError = new Error('EROFS: read-only file system');
    const outcome = await scene.execute();
    deepStrictEqual(
      [outcome, scene.shown.map(each => each.message), scene.removed],
      [
        {kind: 'failed', detail: 'EROFS: read-only file system'},
        [
          "The configuration couldn't be written to /work/ws: EROFS: read-only file system",
        ],
        [SCRATCH],
      ],
    );
  });

  it('F-0802 AC-12, AC-13, 7.E1: a template that fails to apply shows the modal with Cancel and Show Log, writes nothing, and Show Log reveals the log', async () => {
    const results: Array<[string, number, string[]]> = [];
    for (const answer of ['Cancel', 'Show Log', undefined]) {
      const scene = new Scene();
      scene.applied = {kind: 'pullFailed', message: 'denied'};
      scene.answers = [answer];
      const outcome = await scene.execute();
      results.push([
        JSON.stringify(outcome),
        scene.logRevealed,
        [
          ...scene.shown.map(
            each =>
              `${each.severity}: ${each.message} ${each.buttons.join('|')}`,
          ),
          ...scene.removed,
        ],
      ]);
    }
    const failed = '{"kind":"failed","detail":"denied"}';
    const modal = 'error: Application of the template failed. Cancel|Show Log';
    deepStrictEqual(results, [
      [failed, 0, [modal, SCRATCH]],
      [failed, 1, [modal, SCRATCH]],
      [failed, 0, [modal, SCRATCH]],
    ]);
  });

  it('F-0801 AC-36: the CLI’s other failures give their words, and a cancelled apply is a cancelled write with no modal', async () => {
    const details: string[] = [];
    for (const applied of [
      {kind: 'noResult', status: 3},
      {kind: 'malformedResult', field: 'files'},
      {kind: 'spawnFailed', message: 'no node'},
    ] as const) {
      const scene = new Scene();
      scene.applied = applied;
      const outcome = await scene.execute();
      details.push(outcome.kind === 'failed' ? outcome.detail : outcome.kind);
    }
    const cancelled = new Scene();
    cancelled.applied = {kind: 'cancelled'};
    deepStrictEqual(
      [
        details,
        (await cancelled.execute()).kind,
        cancelled.shown.length,
        cancelled.removed,
      ],
      [
        [
          'the CLI gave no result (exit status 3)',
          "the CLI's result has no valid files",
          'no node',
        ],
        'cancelled',
        0,
        [SCRATCH],
      ],
    );
  });

  it('F-0801 7.E8: a write that fails midway puts back the files it replaced and removes what it created, folders included', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/a.txt`, 'old a');
    scene.leaves('a.txt', 'deep/er/b.txt', 'c.txt');
    scene.answers = ['Overwrite'];
    scene.writeError = new Error('ENOSPC: no space left on device');
    scene.failAt = 3;
    const before = [...scene.target.entries()];
    const outcome = await scene.execute();
    deepStrictEqual(
      [
        outcome,
        [...scene.target.entries()],
        [...scene.folders],
        scene.removed,
        scene.shown
          .filter(each => each.severity === 'error')
          .map(each => each.message),
      ],
      [
        {kind: 'failed', detail: 'ENOSPC: no space left on device'},
        before,
        [TARGET],
        [`${TARGET}/deep`, SCRATCH],
        [
          "The configuration couldn't be written to /work/ws: ENOSPC: no space left on device",
        ],
      ],
    );
  });

  it('F-0801 7.E8: a restore that fails too is told with the first failure', async () => {
    const scene = new Scene();
    scene.leaves('a.txt', 'b.txt');
    scene.writeError = new Error('EIO: i/o error');
    scene.failAt = 2;
    scene.removeError = new Error('EBUSY: resource busy');
    deepStrictEqual(await scene.execute(), {
      kind: 'failed',
      detail:
        'EIO: i/o error; the target could not be restored: EBUSY: resource busy',
    });
  });

  it('F-0801 7.E8: a path the CLI reports that is absolute or climbs out of the folder fails the write before any question, and writes nothing', async () => {
    const outcomes: Array<[string, number, number]> = [];
    for (const reported of [
      '/etc/passwd',
      '../x',
      'a/../../x',
      'C:\\x',
      '.\\..\\x',
    ]) {
      const scene = new Scene();
      scene.target.set(`${TARGET}/a.txt`, 'old a');
      scene.applied = {kind: 'applied', files: ['./a.txt', reported]};
      scene.scratchFiles.set('a.txt', 'new a');
      const outcome = await scene.execute();
      outcomes.push([
        outcome.kind === 'failed' ? outcome.detail : outcome.kind,
        scene.written.length,
        scene.shown.filter(each => each.severity === 'info').length,
      ]);
    }
    deepStrictEqual(
      outcomes,
      ['/etc/passwd', '../x', 'a/../../x', 'C:\\x', '.\\..\\x'].map(
        reported => [
          `the template reported a path outside its folder: ${reported}`,
          0,
          0,
        ],
      ),
    );
  });

  it('F-0802 AC-22: the adjustment runs in the scratch folder after the apply and before any question, and its change is what is copied', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/a.txt`, 'old a');
    scene.leaves('a.txt');
    scene.answers = ['Overwrite'];
    const seen: string[] = [];
    const outcome = await scene.execute(scratch => {
      seen.push(scratch, String(scene.shown.length));
      scene.scratchFiles.set('a.txt', 'adjusted');
      return Promise.resolve();
    });
    deepStrictEqual(
      [outcome.kind, seen, scene.target.get(`${TARGET}/a.txt`)],
      ['written', [SCRATCH, '0'], 'adjusted'],
    );
  });

  it('F-0802 AC-22, F-0801 AC-9: a file that is skipped is left as the user has it, whatever the adjustment did to the copy', async () => {
    const scene = new Scene();
    scene.target.set(`${TARGET}/a.txt`, 'old a');
    scene.leaves('a.txt');
    scene.answers = ['Skip'];
    await scene.execute(() => {
      scene.scratchFiles.set('a.txt', 'adjusted');
      return Promise.resolve();
    });
    deepStrictEqual(scene.target.get(`${TARGET}/a.txt`), 'old a');
  });

  it('F-0802 AC-22, F-0801 7.E8: an adjustment that fails writes nothing, asks nothing and shows our message with its words', async () => {
    const scene = new Scene();
    scene.leaves('a.txt');
    const outcome = await scene.execute(() =>
      Promise.reject(new Error('no such file')),
    );
    deepStrictEqual(
      [outcome, scene.written, scene.shown.map(each => each.severity)],
      [{kind: 'failed', detail: 'no such file'}, [], ['error']],
    );
  });
});
