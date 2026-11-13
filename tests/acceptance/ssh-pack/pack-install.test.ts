import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {variable} from '../windows/harness.ts';
import {type StandInGallery, startGallery} from './gallery.ts';

/** The editor's gallery variables pointed at the stand-in gallery, as the launch has them for the editor itself. */
const STAND_IN_GALLERY = {
  VSCODE_GALLERY_SERVICE_URL: 'http://127.0.0.1:23790/_apis/public/gallery',
  VSCODE_GALLERY_ITEM_URL: 'http://127.0.0.1:23790/items',
  VSCODE_GALLERY_CONTROL_URL: 'http://127.0.0.1:23790/control',
  VSCODE_GALLERY_RESOURCE_URL_TEMPLATE:
    'http://127.0.0.1:23790/{publisher}/{name}/{version}/{path}',
};

describe('the pack installed and removed by id (card #2499)', function () {
  this.timeout(300_000);
  let gallery: StandInGallery;

  before(async () => {
    gallery = await startGallery();
  });

  after(async () => {
    await gallery.stop();
  });

  it('F-2007 AC-1 (c2499-install-measure): what the editor command line asks the gallery for when it installs the extension by id', () => {
    const base = path.join(variable('HARNESS_RUN_FOLDER'), 'pack-cli');
    mkdirSync(base, {recursive: true});
    const result = spawnSync(
      path.join(
        path.dirname(variable('HARNESS_VSCODIUM_EXECUTABLE')),
        'bin',
        'codium-insiders',
      ),
      [
        `--extensions-dir=${path.join(base, 'extensions')}`,
        `--user-data-dir=${path.join(base, 'user-data')}`,
        '--install-extension',
        'remote-oss.remote-ssh',
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: {...process.env, ...STAND_IN_GALLERY},
      },
    );
    throw new Error(
      `MEASURED exit ${String(result.status)}; stdout ${JSON.stringify(result.stdout)}; stderr ${JSON.stringify(result.stderr.split('\n').filter(line => !line.includes('DEP0169')))}; requests ${JSON.stringify(gallery.requests())}`,
    );
  });
});
