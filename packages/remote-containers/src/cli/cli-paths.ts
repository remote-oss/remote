/**
 * @fileoverview Where the extension keeps the dev container CLI and its preload: the one place that names them.
 */

import path from 'node:path';

/** The files of the CLI under the extension's folder. */
export interface CliPaths {
  /** The CLI's entry script. */
  entry: string;
  /** The preload that clears `ELECTRON_RUN_AS_NODE` for the CLI's children. */
  preload: string;
}

/** The CLI's files inside the installed extension at `extensionPath`. */
export function cliPathsOf(extensionPath: string): CliPaths {
  return {
    entry: path.join(
      extensionPath,
      'dist',
      'devcontainers-cli',
      'devcontainer.js',
    ),
    preload: path.join(extensionPath, 'dist', 'cli-preload.js'),
  };
}
