import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  containersLog,
  containersLogSince,
  devContainersOf,
  reloadingCommand,
  variable,
} from '../windows/harness.ts';
import {waitForDialog} from '../windows/renderer.ts';
import {featureBuilds, lockfileOf} from './features-support.ts';

const execFileAsync = promisify(execFile);

/** How long a build with Features may take before its dialog, in milliseconds. */
const DIALOG_MILLISECONDS = 600_000;

/** The requests the run's download host answered for the Feature tarball, from its log. */
function tarballRequests(): string[] {
  return readFileSync(variable('HARNESS_DOWNLOADS_LOG'), 'utf8')
    .split('\n')
    .filter(line =>
      line.includes('GET /features/devcontainer-feature-c92-tarball.tgz'),
    );
}

describe('a Feature fetched as a tarball (card tooling-92)', function () {
  this.timeout(1_800_000);
  const {build} = featureBuilds();

  it('tooling-92 (tarball-build): a configuration that names the tarball address builds and connects, the Feature ran in the container, the lockfile holds an integrity for the address, and the download host answered two requests of the CLI for the tarball', async () => {
    const address = variable('HARNESS_FEATURE_TARBALL_URL');
    const before = tarballRequests().length;
    const built = await build('c92-smoke', {features: {[address]: {}}});
    const {stdout} = await execFileAsync('docker', [
      'exec',
      built.containerId,
      'cat',
      '/c92-tarball',
    ]);
    const entry = lockfileOf(built.folder)?.features[address];
    deepStrictEqual(
      [
        stdout.trim(),
        typeof entry?.integrity,
        String(entry?.integrity).length > 0,
        tarballRequests()
          .slice(before)
          .map(line => line.slice(line.lastIndexOf(' ') + 1)),
      ],
      ['tarball', 'string', true, ['devcontainer', 'devcontainer']],
    );
  });

  it('F-0414 AC-31 (c92-integrity): a lockfile integrity that no longer matches the tarball ends Rebuild Container with the dialog of a failed build and no new container', async () => {
    const address = variable('HARNESS_FEATURE_TARBALL_URL');
    const built = await build('c92-integrity', {features: {[address]: {}}});
    const file = path.join(
      built.folder,
      '.devcontainer',
      'devcontainer-lock.json',
    );
    const lock = JSON.parse(readFileSync(file, 'utf8')) as {
      features: Record<string, {integrity?: string}>;
    };
    const entry = lock.features[address];
    if (entry !== undefined) {
      entry.integrity = `sha256:${'0'.repeat(64)}`;
    }
    writeFileSync(file, JSON.stringify(lock, undefined, 2));
    const mark = containersLog().length;
    await reloadingCommand(built.window, 'remote-containers.rebuildContainer');
    const dialog = await waitForDialog(built.window, DIALOG_MILLISECONDS);
    const failing = containersLogSince(mark).filter(line =>
      line.includes('Failed to fetch tarball for c92-tarball'),
    );
    deepStrictEqual(
      [
        dialog.message,
        dialog.details,
        dialog.buttons,
        failing.length > 0,
        await devContainersOf(built.folder),
      ],
      [
        '',
        'An error occurred setting up the container.',
        ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
        true,
        [],
      ],
    );
  });
});
