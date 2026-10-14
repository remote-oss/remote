/**
 * @fileoverview The fixture run of the tooling-46 rows (#824): today's real outcomes of the three phases, the
 * mock-up's sizes in bytes, and the timings the rows measure against.
 */

import type {PackageRun} from './package-view.ts';

/** The fixture run, as of the card's writing. */
export const FIXTURE: PackageRun = {
  identifiers: [
    'remote-containers: src/identifiers.generated.ts',
    'remote-explorer: src/identifiers.generated.ts',
    'remote-ssh: src/identifiers.generated.ts',
    'remote-ssh-edit: src/identifiers.generated.ts',
  ],
  build: [
    'lib-authority: no src/extension.ts, skipped',
    'lib-companion: no src/extension.ts, skipped',
    'lib-forwarding: no src/extension.ts, skipped',
    'lib-helper: no src/extension.ts, skipped',
    'lib-host: no src/extension.ts, skipped',
    'lib-identifiers: no src/extension.ts, skipped',
    'lib-log: no src/extension.ts, skipped',
    'lib-product: no src/extension.ts, skipped',
    'lib-server: no src/extension.ts, skipped',
    'lib-ssh: no src/extension.ts, skipped',
    'lib-standdown: no src/extension.ts, skipped',
    'lib-wsl: no src/extension.ts, skipped',
    'remote-containers: dist/extension.js',
    'remote-containers: dist/cli-preload.js',
    'remote-containers: dist/devcontainers-cli',
    'remote-explorer: dist/extension.js',
    'remote-explorer: dist/web/extension.js',
    'remote-extensionpack: no src/extension.ts, skipped',
    'remote-server: no src/extension.ts, skipped',
    'remote-ssh: dist/extension.js',
    'remote-ssh: dist/askpass.js, dist/connection-helper.js',
    'remote-ssh-edit: dist/extension.js',
    'remote-wsl: no src/extension.ts, skipped',
  ],
  packages: [
    {
      line: 'remote-containers: dist/remote-containers-0.1.0.vsix',
      bytes: 412 * 1024,
    },
    {
      line: 'remote-explorer: dist/remote-explorer-0.1.0.vsix',
      bytes: 168 * 1024,
    },
    {line: 'remote-ssh: dist/remote-ssh-0.1.0.vsix', bytes: 503 * 1024},
    {
      line: 'remote-ssh-edit: dist/remote-ssh-edit-0.1.0.vsix',
      bytes: 71 * 1024,
    },
  ],
  milliseconds: {identifiers: 42, build: 1310, package: 1548},
};
