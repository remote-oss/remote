/**
 * @fileoverview fetch-cli-archives: puts the pinned CLI archives a run needs into the run's download cache, in a CI step
 * of its own, so that the acceptance step after it runs without the token that reads the CLI archives' repository.
 *
 *   node tools/fetch-cli-archives.ts --launches <entries>   fetch them when one of the launches the entries choose
 *                                                           starts the CLI-source editor, else nothing
 *
 * The entries are the acceptance run's (`all`, `none`, labels, `@<group>`, `<label>:<file>+…`). The archives are
 * fetched with REMOTE_OSS_CLI_ARCHIVES_TOKEN, checked against their pins and written where the run's download host
 * looks first, so the run finds them there and never asks for the token.
 */

import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  chosenLaunches,
  privateAssetDownload,
  runArgumentsOf,
  startsPinnedCliEditor,
} from './acceptance.ts';
import {
  CLI_ARCHIVES,
  type PinnedCliArchive,
  cliArchiveOf,
  servedPlatforms,
} from './acceptance-downloads.ts';
import {launchesOf} from './acceptance-launches.ts';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** What the fetch reads and writes, which a test replaces. */
export interface FetchDependencies {
  download(address: string, token: string | undefined): Promise<Uint8Array>;
  writeFile(file: string, bytes: Uint8Array): void;
  architecture: string;
  pins: Readonly<Record<string, PinnedCliArchive>>;
  /** The run's download cache, `<root>/.vscode-test/downloads` when undefined. */
  cacheFolder?: string;
}

const REAL_DEPENDENCIES: FetchDependencies = {
  download: (address, token) => privateAssetDownload(address, token),
  writeFile: writeFileSync,
  architecture: process.arch,
  pins: CLI_ARCHIVES,
};

/**
 * Fetches the pinned CLI archives of this machine's served platforms into `root`'s download cache when one of the
 * launches `commandArguments` choose starts the CLI-source editor, and gives the lines to print. An archive already
 * there with its pinned bytes is kept. Throws when the arguments choose nothing known, or a fetch fails.
 */
export async function fetchCliArchives(
  root: string,
  commandArguments: readonly string[],
  token: string | undefined,
  dependencies: FetchDependencies = REAL_DEPENDENCIES,
): Promise<string[]> {
  const parsed = runArgumentsOf(['--editor', 'vscodium', ...commandArguments]);
  if (parsed === undefined) {
    throw new Error(
      'usage: node tools/fetch-cli-archives.ts --launches <entries>',
    );
  }
  const chosen = chosenLaunches(launchesOf(root), parsed.launches);
  if (typeof chosen === 'string') {
    throw new Error(chosen);
  }
  if (!chosen.some(startsPinnedCliEditor)) {
    return [
      'no chosen launch starts the CLI-source editor, so no CLI archive is fetched',
    ];
  }
  const cacheFolder =
    dependencies.cacheFolder ?? path.join(root, '.vscode-test', 'downloads');
  const lines: string[] = [];
  for (const platform of servedPlatforms(dependencies.architecture)) {
    const file = await cliArchiveOf(
      cacheFolder,
      platform,
      address => dependencies.download(address, token),
      dependencies.writeFile,
      dependencies.pins,
    );
    lines.push(
      file === undefined
        ? `${platform}: no CLI archive is pinned`
        : `${platform}: ${path.basename(file)} matches its pin`,
    );
  }
  return lines;
}

if (isMainModule(import.meta.url)) {
  try {
    const lines = await fetchCliArchives(
      REPOSITORY_ROOT,
      process.argv.slice(2),
      process.env.REMOTE_OSS_CLI_ARCHIVES_TOKEN,
    );
    for (const line of lines) {
      console.log(`fetch-cli-archives: ${line}`);
    }
  } catch (caught) {
    console.error(
      `fetch-cli-archives: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    process.exitCode = 1;
  }
}
