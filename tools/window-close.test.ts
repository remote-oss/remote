import {strictEqual, rejects} from 'node:assert';
import {spawn, type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

/** The part of the windows harness these rows call, from its bundle (the tools' project can't import its sources). */
interface Harness {
  closeWindow(name: string, milliseconds?: number): Promise<void>;
}

const NAME = 'w1';

describe('closeWindow (card tooling-84, #1505)', () => {
  let bundleFolder = '';
  let harness: Harness;
  let folder = '';
  let previous: string | undefined;
  let extensionHost: ChildProcess;

  before(async () => {
    const {build} = await import('esbuild');
    bundleFolder = mkdtempSync(path.join(tmpdir(), 'window-close-bundle-'));
    const bundle = path.join(bundleFolder, 'harness.cjs');
    await build({
      entryPoints: [
        path.join(
          import.meta.dirname,
          '..',
          'tests',
          'acceptance',
          'windows',
          'harness.ts',
        ),
      ],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['vscode'],
      logLevel: 'silent',
    });
    harness = createRequire(import.meta.url)(bundle) as Harness;
  });

  after(() => {
    rmSync(bundleFolder, {recursive: true, force: true});
  });

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'window-close-'));
    mkdirSync(path.join(folder, 'pids'));
    previous = process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS;
    process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS = path.join(folder, 'pids');
    // A process that stands for the window's extension host, recorded as the agent records its own.
    extensionHost = spawn('sleep', ['30'], {stdio: 'ignore'});
    writeFileSync(path.join(folder, 'pids', String(extensionHost.pid)), NAME);
  });

  afterEach(() => {
    extensionHost.kill('SIGKILL');
    if (previous === undefined) {
      delete process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS;
    } else {
      process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS = previous;
    }
    rmSync(folder, {recursive: true, force: true});
  });

  it('tooling-84: a window whose agent reports deactivated is closed, its extension host still running', async () => {
    setTimeout(() => {
      appendFileSync(
        path.join(folder, `${NAME}.events.jsonl`),
        `${JSON.stringify({event: 'deactivated'})}\n`,
      );
    }, 300);
    await harness.closeWindow(NAME, 5_000);
    strictEqual(extensionHost.exitCode, null);
  });

  it('tooling-84: a window whose extension host exits without the event is closed', async () => {
    setTimeout(() => {
      extensionHost.kill('SIGKILL');
    }, 300);
    await harness.closeWindow(NAME, 5_000);
  });

  it('tooling-84: a window that neither deactivates nor exits fails after the wait, naming its extension host', async () => {
    await rejects(harness.closeWindow(NAME, 1_000), {
      message: `timed out waiting for window ${NAME} to deactivate: its extension host ${String(extensionHost.pid)} is still running`,
    });
  });
});
