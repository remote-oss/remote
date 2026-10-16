import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildSync} from 'esbuild';

/** A folder that holds the bundled preload, and the fake `node-pty` copies the rows ask for; removed after. */
interface Scene {
  folder: string;
  preload: string;
  /** Writes a fake `node-pty` under `parent`, whose `spawn()` gives `answer`, and gives `parent`. */
  fakePty(parent: string, answer?: string): string;
}

function withScene(test: (scene: Scene) => void): void {
  const folder = mkdtempSync(path.join(tmpdir(), 'preload-'));
  try {
    const bundled = buildSync({
      entryPoints: [
        path.join(
          import.meta.dirname,
          '..',
          '..',
          'src',
          'programs',
          'cli-preload.ts',
        ),
      ],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
    });
    const preload = path.join(folder, 'cli-preload.js');
    writeFileSync(preload, bundled.outputFiles[0]?.text ?? '');
    test({
      folder,
      preload,
      fakePty: (parent, answer = 'fake') => {
        const modulePath = path.join(folder, parent, 'node-pty');
        mkdirSync(modulePath, {recursive: true});
        writeFileSync(
          path.join(modulePath, 'index.js'),
          `module.exports = {spawn: () => ${JSON.stringify(answer)}};`,
        );
        writeFileSync(
          path.join(modulePath, 'package.json'),
          '{"main":"index.js"}',
        );
        return path.join(folder, parent);
      },
    });
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

/** Runs `script` under the preload with `environment` (NODE_PATH removed unless given), and gives its output. */
function underPreload(
  scene: Scene,
  script: string,
  environment: Record<string, string>,
): {stdout: string; marker: unknown; status: number | null} {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'NODE_PATH'),
  );
  const finished = spawnSync(
    process.execPath,
    ['--require', scene.preload, '-e', script],
    {
      env: {...inherited, ELECTRON_RUN_AS_NODE: '1', ...environment},
      encoding: 'utf8',
    },
  );
  const firstLine = finished.stderr.split('\n')[0] ?? '';
  return {
    stdout: finished.stdout.trim(),
    marker: JSON.parse(firstLine),
    status: finished.status,
  };
}

const LOADED_FROM_EDITOR = {
  marker: 'remote-oss-cli-preload',
  nodePty: {loaded: true, from: 'editor'},
};
const NOT_LOADED = {
  marker: 'remote-oss-cli-preload',
  nodePty: {loaded: false, from: 'none'},
};

describe('the CLI preload (card containers-04)', () => {
  it('C3: a program started with the preload does not see ELECTRON_RUN_AS_NODE', () => {
    withScene(scene => {
      deepStrictEqual(
        underPreload(
          scene,
          'console.log(process.env.ELECTRON_RUN_AS_NODE ?? "absent")',
          {},
        ).stdout,
        'absent',
      );
    });
  });

  it('ADR-0011: with the editor folder present, the CLI process resolves node-pty, and the marker says loaded from editor', function () {
    if (process.platform !== 'linux') {
      this.skip();
    }
    withScene(scene => {
      const editor = scene.fakePty('editor/node_modules.asar');
      const outcome = underPreload(
        scene,
        'console.log(require("node-pty").spawn())',
        {REMOTE_OSS_EDITOR_MODULES: editor},
      );
      deepStrictEqual(
        [outcome.stdout, outcome.marker],
        ['fake', LOADED_FROM_EDITOR],
      );
    });
  });

  it("ADR-0011: a child of the CLI sees neither REMOTE_OSS_EDITOR_MODULES nor a new NODE_PATH, and a NODE_PATH of the user's stays", function () {
    if (process.platform !== 'linux') {
      this.skip();
    }
    withScene(scene => {
      const editor = scene.fakePty('editor/node_modules.asar');
      const script =
        'console.log(JSON.stringify([process.env.REMOTE_OSS_EDITOR_MODULES ?? "absent", process.env.NODE_PATH ?? "absent", process.env.ELECTRON_RUN_AS_NODE ?? "absent"]))';
      deepStrictEqual(
        [
          underPreload(scene, script, {REMOTE_OSS_EDITOR_MODULES: editor})
            .stdout,
          underPreload(scene, script, {
            REMOTE_OSS_EDITOR_MODULES: editor,
            NODE_PATH: '/u/own',
          }).stdout,
        ],
        [
          JSON.stringify(['absent', 'absent', 'absent']),
          JSON.stringify(['absent', '/u/own', 'absent']),
        ],
      );
    });
  });

  it("ADR-0011: a NODE_PATH of the user's that holds node-pty is the copy the default resolution takes, and the marker says from default", function () {
    if (process.platform !== 'linux') {
      this.skip();
    }
    withScene(scene => {
      const editor = scene.fakePty('editor/node_modules.asar', 'editor-copy');
      const own = scene.fakePty('own');
      const outcome = underPreload(
        scene,
        'console.log(require("node-pty").spawn())',
        {REMOTE_OSS_EDITOR_MODULES: editor, NODE_PATH: own},
      );
      deepStrictEqual(
        [outcome.stdout, outcome.marker],
        [
          'fake',
          {
            marker: 'remote-oss-cli-preload',
            nodePty: {loaded: true, from: 'default'},
          },
        ],
      );
    });
  });

  it('ADR-0011: with the folder absent the marker says not loaded, and nothing else changes', () => {
    withScene(scene => {
      const outcome = underPreload(
        scene,
        'try { require("node-pty"); console.log("found"); } catch { console.log("missing"); }',
        {},
      );
      deepStrictEqual(
        [outcome.stdout, outcome.marker],
        ['missing', NOT_LOADED],
      );
    });
  });

  it('ADR-0011: a folder whose node-pty cannot load gives not loaded', () => {
    withScene(scene => {
      const empty = path.join(scene.folder, 'empty');
      mkdirSync(empty);
      const outcome = underPreload(scene, 'console.log("ran")', {
        REMOTE_OSS_EDITOR_MODULES: empty,
      });
      deepStrictEqual(
        [outcome.stdout, outcome.marker, outcome.status],
        ['ran', NOT_LOADED, 0],
      );
    });
  });
});
