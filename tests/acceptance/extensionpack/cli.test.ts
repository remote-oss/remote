import {deepStrictEqual} from 'node:assert';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {
  DIST,
  installedIn,
  launcher,
  namedAfterPack,
  PACK_ID,
  PACK_VERSION,
  type Profile,
  profileOf,
} from './pack-support.ts';

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
