/**
 * @fileoverview Where the extension keeps the dev container CLI and its preload, and where the editor keeps the Node
 * modules the preload takes `node-pty` from: the one place that names them.
 */

import path from 'node:path';

/** The files of the CLI under the extension's folder, and the editor's module folder. */
export interface CliPaths {
  /** The CLI's entry script. */
  entry: string;
  /** The preload that clears `ELECTRON_RUN_AS_NODE` for the CLI's children and resolves `node-pty` for the CLI. */
  preload: string;
  /** The folder the editor keeps its own Node modules in; the preload resolves `node-pty` from it. */
  editorModules: string;
}

/** The CLI's files inside the installed extension at `extensionPath`, and the module folder of the editor at `appRoot`. */
export function cliPathsOf(extensionPath: string, appRoot: string): CliPaths {
  return {
    entry: path.join(
      extensionPath,
      'dist',
      'devcontainers-cli',
      'devcontainer.js',
    ),
    preload: path.join(extensionPath, 'dist', 'cli-preload.js'),
    editorModules: path.join(appRoot, 'node_modules.asar'),
  };
}

/** Where the bootstrap image of a clone in a volume keeps the dev container CLI the extension bundles, and the preload the CLI runs with. */
export const BOOTSTRAP_CLI = {
  entry: '/usr/local/share/remote-oss/devcontainers-cli/devcontainer.js',
  preload: '/usr/local/share/remote-oss/cli-preload.js',
} as const;

/** The names in the bootstrap image's build context of the CLI's folder and the preload, which the image's definition copies in. */
export const CONTEXT_NAMES = {
  cliFolder: 'devcontainers-cli',
  preload: 'cli-preload.js',
} as const;
