import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {variable} from '../windows/harness.ts';

/** The repository's folders: the root, the built VSIX files and the pack. */
const REPOSITORY = path.join(import.meta.dirname, '..', '..', '..');
const DIST = path.join(REPOSITORY, 'dist');
const PACK_ID = 'remote-oss.vscode-remote-extensionpack';
const PACK_VERSION = (
  JSON.parse(
    readFileSync(
      path.join(REPOSITORY, 'packages', 'remote-extensionpack', 'package.json'),
      'utf8',
    ),
  ) as {version: string}
).version;

/** The editor's gallery variables pointed at a closed port, as the launch has them for the editor itself. */
const UNREACHABLE_GALLERY = {
  VSCODE_GALLERY_SERVICE_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_ITEM_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_CONTROL_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_RESOURCE_URL_TEMPLATE:
    'http://127.0.0.1:1/{publisher}/{name}/{version}/{path}',
};

/** The folders of one command-line profile: its extensions, its user data and its logs, under the run's folder. */
function profileOf(name: string) {
  const base = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'extensionpack-cli',
    name,
  );
  mkdirSync(base, {recursive: true});
  return {
    extensions: path.join(base, 'extensions'),
    userData: path.join(base, 'user-data'),
    logs: path.join(base, 'state'),
  };
}

type Profile = ReturnType<typeof profileOf>;

/** Runs the editor's command-line launcher on `profile` with `options`, the gallery unreachable, and gives what it did. */
function launcher(profile: Profile, options: string[]) {
  const result = spawnSync(
    path.join(
      path.dirname(variable('HARNESS_VSCODIUM_EXECUTABLE')),
      'bin',
      'codium-insiders',
    ),
    [
      `--extensions-dir=${profile.extensions}`,
      `--user-data-dir=${profile.userData}`,
      ...options,
    ],
    {
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        ...UNREACHABLE_GALLERY,
        XDG_STATE_HOME: profile.logs,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout.split('\n').filter(line => line !== ''),
    stderr: result.stderr
      .split('\n')
      .filter(
        line =>
          line !== '' &&
          !line.includes('DEP0169') &&
          !line.includes('trace-deprecation'),
      ),
  };
}

/** The VSIX files of the pack and the two members it names, as `pnpm package` built them. */
function vsixFiles(): string[] {
  return [
    /^remote-ssh-\d/,
    /^remote-containers-\d/,
    /^vscode-remote-extensionpack-\d/,
  ].map(pattern =>
    path.join(
      DIST,
      readdirSync(DIST).find(file => pattern.test(file)) ?? 'missing.vsix',
    ),
  );
}

/** The extensions a profile holds, by their folder names. */
function installedIn(profile: Profile): string[] {
  return readdirSync(profile.extensions).filter(entry =>
    entry.startsWith('remote-oss.'),
  );
}

/** The paths below `folder` named after the pack's id, except core's cache of the VSIX files it installed. */
function namedAfterPack(folder: string): string[] {
  return readdirSync(folder, {recursive: true})
    .map(String)
    .filter(
      entry =>
        entry.toLowerCase().includes(PACK_ID) &&
        !entry.includes('CachedExtensionVSIXs'),
    );
}

describe('the extension pack through the editor’s command-line launcher (card coverage-76)', function () {
  this.timeout(300_000);

  let installed: Profile;
  let installedBefore: string[] = [];

  before(() => {
    installed = profileOf('installed');
    launcher(
      installed,
      vsixFiles().flatMap(file => ['--install-extension', file]),
    );
    installedBefore = installedIn(installed);
  });

  it('F-9101 AC-12 (install-again): installing the installed pack by its id again prints that it is already installed, exits 0 and changes nothing', () => {
    const again = launcher(installed, ['--install-extension', PACK_ID]);
    deepStrictEqual(
      {
        status: again.status,
        lines: again.stdout.map(line => line.replace(/ Use '--force'.*$/, '')),
        unchanged: installedIn(installed),
      },
      {
        status: 0,
        lines: [
          'Installing extensions...',
          `Extension '${PACK_ID}' v${PACK_VERSION} is already installed.`,
        ],
        unchanged: installedBefore,
      },
    );
  });

  it('F-9101 AC-16 (install-offline): installing the pack by its id with the gallery unreachable prints Installing extensions, then the error with the network error on stderr, exits 1 and installs nothing', () => {
    const profile = profileOf('offline');
    const result = launcher(profile, ['--install-extension', PACK_ID]);
    deepStrictEqual(
      {
        status: result.status,
        stdout: result.stdout,
        error: result.stderr[0]?.startsWith(
          'Error while installing extensions: connect ECONNREFUSED',
        ),
        installed: installedIn(profile),
      },
      {
        status: 1,
        stdout: ['Installing extensions...'],
        error: true,
        installed: [],
      },
    );
  });

  it('F-9101 AC-19 (install-writes): after installing the pack and its members, no global-storage folder, log folder or state key of the pack’s own exists', () => {
    deepStrictEqual(
      {
        installedPack: installedBefore.some(entry => entry.startsWith(PACK_ID)),
        userData: namedAfterPack(installed.userData),
        logs: namedAfterPack(installed.logs),
      },
      {installedPack: true, userData: [], logs: []},
    );
  });
});
