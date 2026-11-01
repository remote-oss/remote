import {deepStrictEqual} from 'node:assert';
import {spawn, spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

/** Bundles the preload into `folder` and gives its path. */
function bundledPreload(folder: string): string {
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
  return preload;
}

function withScene(test: (scene: Scene) => void): void {
  const folder = mkdtempSync(path.join(tmpdir(), 'preload-'));
  try {
    const preload = bundledPreload(folder);
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

/** The platforms the preload gives a pty on; elsewhere the rows that need one are skipped. */
const PTY_PLATFORMS: readonly string[] = ['linux', 'darwin'];

const LOADED_FROM_EDITOR = {
  marker: 'remote-oss-cli-preload',
  nodePty: {loaded: true, from: 'editor'},
};
const NOT_LOADED = {
  marker: 'remote-oss-cli-preload',
  nodePty: {loaded: false, from: 'none'},
};

function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Starts a parent that runs the preloaded CLI in a group of its own, as the host does, and a child of that CLI, then
 * gives `check` the pids of the two. The parent ends once the CLI has written its pids when `parent` is `ends`, and
 * stays until killed when it is `stays`; it is killed after the check either way.
 */
async function withParent(
  parent: 'ends' | 'stays',
  check: (pids: number[]) => Promise<void>,
): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), 'preload-parent-'));
  const pidFile = path.join(folder, 'pids.json');
  const parentScript = path.join(folder, 'parent.js');
  try {
    const preload = bundledPreload(folder);
    // The CLI: a child of its own that waits, and its own wait.
    const script = path.join(folder, 'cli.js');
    writeFileSync(
      script,
      `const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);`,
    );
    writeFileSync(
      parentScript,
      `const {spawn} = require('node:child_process');
const {existsSync} = require('node:fs');
spawn(process.execPath, ['--require', ${JSON.stringify(preload)}, ${JSON.stringify(script)}], {detached: true, stdio: 'ignore'}).unref();
const wait = setInterval(() => { if (existsSync(${JSON.stringify(pidFile)}) && ${JSON.stringify(parent)} === 'ends') { clearInterval(wait); } }, 50);`,
    );
    const started = spawn(process.execPath, [parentScript], {stdio: 'ignore'});
    let pids: number[] = [];
    for (let attempt = 0; attempt < 100 && pids.length === 0; attempt += 1) {
      try {
        pids = JSON.parse(readFileSync(pidFile, 'utf8')) as number[];
      } catch {
        await pause(100);
      }
    }
    try {
      await check(pids);
    } finally {
      started.kill('SIGKILL');
    }
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

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
    if (!PTY_PLATFORMS.includes(process.platform)) {
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
    if (!PTY_PLATFORMS.includes(process.platform)) {
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
    if (!PTY_PLATFORMS.includes(process.platform)) {
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

  it('connect-120: a CLI whose parent is gone ends its whole process group, a child of it included', async function () {
    this.timeout(30_000);
    await withParent('ends', async pids => {
      let remaining = pids;
      for (
        let attempt = 0;
        attempt < 120 && remaining.length > 0;
        attempt += 1
      ) {
        await pause(100);
        remaining = remaining.filter(alive);
      }
      for (const processId of remaining) {
        process.kill(processId, 'SIGKILL');
      }
      deepStrictEqual([pids.length, remaining], [2, []]);
    });
  });

  it('connect-120: a CLI whose parent stays alive is not signalled, nor is a child of it', async function () {
    this.timeout(30_000);
    await withParent('stays', async pids => {
      await pause(3000);
      const remaining = pids.filter(alive);
      for (const processId of pids) {
        process.kill(processId, 'SIGKILL');
      }
      deepStrictEqual([pids.length, remaining], [2, pids]);
    });
  });
});
