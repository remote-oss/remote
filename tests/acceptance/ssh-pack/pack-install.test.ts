import {execFile} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {deepStrictEqual} from 'node:assert';
import {variable} from '../windows/harness.ts';
import {type StandInGallery, startGallery} from './gallery.ts';

const execFileAsync = promisify(execFile);

/** The repository's root, where the built VSIX files and the package folders are. */
const REPOSITORY = path.join(import.meta.dirname, '..', '..', '..');

/** The editor's gallery variables pointed at the stand-in gallery, as the launch has them for the editor itself. */
const STAND_IN_GALLERY = {
  VSCODE_GALLERY_SERVICE_URL: 'http://127.0.0.1:23790/_apis/public/gallery',
  VSCODE_GALLERY_ITEM_URL: 'http://127.0.0.1:23790/items',
  VSCODE_GALLERY_CONTROL_URL: 'http://127.0.0.1:23790/control',
  VSCODE_GALLERY_RESOURCE_URL_TEMPLATE:
    'http://127.0.0.1:23790/{publisher}/{name}/{version}/{path}',
};

/** What the editor's command line did: its exit status and the lines it printed, without core's deprecation warning. */
interface Ran {
  status: number | null;
  lines: string[];
}

describe('the pack installed and removed by id (card #2499)', function () {
  this.timeout(300_000);
  const base = path.join(variable('HARNESS_RUN_FOLDER'), 'pack-cli');
  let gallery: StandInGallery;

  /** Runs the editor's command line on the fresh profile of this suite, with the stand-in gallery as its gallery. */
  async function runEditor(...options: string[]): Promise<Ran> {
    const result = await execFileAsync(
      path.join(
        path.dirname(variable('HARNESS_VSCODIUM_EXECUTABLE')),
        'bin',
        'codium-insiders',
      ),
      [
        `--extensions-dir=${path.join(base, 'extensions')}`,
        `--user-data-dir=${path.join(base, 'user-data')}`,
        ...options,
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          ...STAND_IN_GALLERY,
          XDG_STATE_HOME: path.join(base, 'state'),
        },
      },
    ).then(
      ({stdout, stderr}) => ({status: 0, stdout, stderr}),
      (caught: unknown) => {
        const failure = caught as {
          code?: number | null;
          stdout?: string;
          stderr?: string;
        };
        return {
          status: failure.code ?? null,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? '',
        };
      },
    );
    return {
      status: result.status,
      lines: `${result.stdout}\n${result.stderr}`
        .split('\n')
        .filter(
          line =>
            line !== '' &&
            !line.includes('DEP0169') &&
            !line.includes('trace-deprecation'),
        ),
    };
  }

  before(async () => {
    rmSync(base, {recursive: true, force: true});
    mkdirSync(base, {recursive: true});
    gallery = await startGallery(REPOSITORY);
  });

  after(async () => {
    await gallery.stop();
  });

  it('F-2007 AC-1 (c2499-install-by-id): installing the extension by id from a gallery that has both companions installs all three without a dialog', async () => {
    const installed = await runEditor(
      '--install-extension',
      'remote-oss.remote-ssh',
    );
    const listed = await runEditor('--list-extensions', '--show-versions');
    deepStrictEqual(
      [
        installed.status,
        listed.lines
          .filter(line => line.startsWith('remote-oss.'))
          .map(line => line.split('@')[0])
          .sort(),
        ['remote-oss.remote-ssh-edit', 'remote-oss.remote-explorer'].every(
          identifier => gallery.queriedIds().includes(identifier),
        ),
      ],
      [
        0,
        [
          'remote-oss.remote-explorer',
          'remote-oss.remote-ssh',
          'remote-oss.remote-ssh-edit',
        ],
        true,
      ],
    );
  });

  it('F-2007 AC-10 (c2499-uninstall-by-id): uninstalling the extension by id removes all three', async () => {
    const removed = await runEditor(
      '--uninstall-extension',
      'remote-oss.remote-ssh',
    );
    const listed = await runEditor('--list-extensions');
    deepStrictEqual(
      [
        removed.status,
        listed.lines.filter(line => line.startsWith('remote-oss.')),
      ],
      [0, []],
    );
  });
});
