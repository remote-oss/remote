/**
 * @fileoverview The dev container CLI on a remote host: the editor's server there gives the `node` (found when a window
 * installed it, else installed with no start), and the pinned CLI and the preload are copied once for each version of
 * the extension into a folder of the server's data folder, whose last step is a rename, so that a folder that is there
 * is whole and a second run with the same version copies nothing. Everything goes over the host channel, so the same
 * steps serve any host that has one.
 */

import path from 'node:path';
import type {HostChannel, ScriptRequest} from 'lib-host';
import type {Logger} from 'lib-log';
import {cliNotPlaced} from '../connect/failures.ts';
import {
  installedServerOnHost,
  type ServerStepDependencies,
} from '../connect/server-steps.ts';
import type {Failed} from 'lib-authority';
import type {PlacedCli} from './cli-paths.ts';

/** The folder of the server's data folder that holds the CLI of each version. */
const CLI_FOLDER = 'remote-oss-containers-cli';

/** The file that a whole folder holds, written before the folder gets its name. */
const WHOLE_MARKER = '.whole';

/** Prints `whole` when the folder of this version is there, else `missing`. */
const CHECK_SCRIPT = `if [ -f "$VERSION_FOLDER/${WHOLE_MARKER}" ]; then echo whole; else echo missing; fi\n`;

/**
 * Makes the folder the copy goes to and the folders below it, and removes the half-copied folders that windows that
 * ended left more than a day ago.
 */
const PREPARE_SCRIPT = [
  'set -e',
  `find "$CLI_FOLDER" -maxdepth 1 -name '*.part-*' -mtime +0 -exec rm -rf {} + 2>/dev/null || true`,
  'printf "%s\\n" "$DIRECTORIES" | while IFS= read -r directory; do',
  '  mkdir -p -- "$PART_FOLDER/$directory"',
  'done',
  '',
].join('\n');

/**
 * Marks the copy whole and gives it the name of the version. A folder of that name already there, from a window that
 * ran at the same time, stays and the copy goes: the rename of one folder over another puts it inside.
 */
const PUBLISH_SCRIPT = [
  'set -e',
  `: > "$PART_FOLDER/${WHOLE_MARKER}"`,
  'if [ ! -e "$VERSION_FOLDER" ]; then mv -- "$PART_FOLDER" "$VERSION_FOLDER" 2>/dev/null || true; fi',
  'rm -rf -- "$PART_FOLDER" "$VERSION_FOLDER/$(basename "$PART_FOLDER")"',
  `[ -f "$VERSION_FOLDER/${WHOLE_MARKER}" ]`,
  '',
].join('\n');

/** What a placement is asked to do. */
export interface PlaceRequest {
  channel: HostChannel;
  /** The user whose server is installed, for its lock's name. */
  remoteUser: string;
  /** The version of the extension, which names the folder: another version is another folder. */
  version: string;
  /** The folder of the pinned CLI on the client, and the preload's file there. */
  client: {cliFolder: string; preload: string};
  /** Names a half-copied folder so that no other run's is the same. */
  newToken: () => string;
  onPhase(phase: 'installing'): void;
  onDownloadPercent(percent: number): void;
  cancellation: AbortSignal;
}

/** What a placement needs besides the connect's: the client's folders listed. */
export interface PlacePorts {
  /** The files below `folder`, each by its path relative to it. */
  listFiles(folder: string): Promise<string[]>;
}

/** How a placement ended. */
export type PlaceResult =
  {kind: 'placed'; placed: PlacedCli} | {kind: 'failed'; failure: Failed};

/** The request of a script run with `environment`. */
function scriptOf(
  script: string,
  environment: Record<string, string>,
  cancellation: AbortSignal,
): ScriptRequest {
  return {
    script,
    interpreter: 'posixShell',
    environment,
    input: {kind: 'text', text: ''},
    cancellation,
  };
}

/** Where the CLI of one version goes on a host: the folder of all versions, and the folder of this one. */
export interface CliFolders {
  cliFolder: string;
  versionFolder: string;
}

/**
 * Puts the CLI of the version in `folders` on the host of `request.channel`, copying nothing when its folder is there;
 * undefined when it is there at the end, else the failure, after the log says why.
 */
export async function placeCliFiles(
  logger: Logger,
  ports: PlacePorts,
  request: PlaceRequest,
  folders: CliFolders,
): Promise<Failed | undefined> {
  const {channel, cancellation} = request;
  const {cliFolder, versionFolder} = folders;

  /** Runs the script `script`, and names why it did not exit 0, if it did not. */
  async function ranScript(
    script: string,
    extra: Record<string, string>,
    onLine: (line: string) => void,
  ): Promise<string | undefined> {
    const outcome = await channel.runScript(
      scriptOf(
        script,
        {CLI_FOLDER: cliFolder, VERSION_FOLDER: versionFolder, ...extra},
        cancellation,
      ),
      onLine,
    );
    if (outcome.kind === 'failed') {
      return outcome.failure.detail;
    }
    return outcome.status === 0
      ? undefined
      : `the script on the host ended with status ${String(outcome.status)}`;
  }

  let checked: string | undefined;
  const checkFailure = await ranScript(CHECK_SCRIPT, {}, line => {
    checked = line;
  });
  if (checkFailure !== undefined) {
    logger.info(
      `the CLI's folder on the host was not checked: ${checkFailure}`,
    );
    return cliNotPlaced();
  }
  if (checked === 'whole') {
    return undefined;
  }
  const partFolder = `${versionFolder}.part-${request.newToken()}`;
  const files = [
    ...(await ports.listFiles(request.client.cliFolder)).map(relative => ({
      localFile: path.join(request.client.cliFolder, relative),
      relative,
    })),
    {
      localFile: request.client.preload,
      relative: path.basename(request.client.preload),
    },
  ];
  const directories = [
    ...new Set(files.map(file => path.posix.dirname(file.relative))),
  ];
  const prepared = await ranScript(
    PREPARE_SCRIPT,
    {PART_FOLDER: partFolder, DIRECTORIES: directories.join('\n')},
    () => undefined,
  );
  if (prepared !== undefined) {
    logger.info(`the CLI's folder on the host was not made: ${prepared}`);
    return cliNotPlaced();
  }
  for (const file of files) {
    const copied = await channel.copyToHost({
      localFile: file.localFile,
      remotePath: `${partFolder}/${file.relative}`,
      cancellation,
    });
    if (copied.kind === 'failed') {
      logger.info(
        `the CLI's file ${file.relative} was not copied to the host: ${copied.failure.detail}`,
      );
      return cliNotPlaced();
    }
  }
  const published = await ranScript(
    PUBLISH_SCRIPT,
    {PART_FOLDER: partFolder},
    () => undefined,
  );
  if (published !== undefined) {
    logger.info(`the CLI's folder on the host was not completed: ${published}`);
    return cliNotPlaced();
  }
  return undefined;
}

/**
 * Finds or installs the server's `node` on the host and puts the CLI of `request.version` beside it, copying nothing
 * when the folder of that version is there.
 */
export async function placeCli(
  dependencies: ServerStepDependencies,
  ports: PlacePorts,
  request: PlaceRequest,
): Promise<PlaceResult> {
  const server = await installedServerOnHost(dependencies, request);
  if (server.kind === 'failed') {
    return server;
  }
  const cliFolder = `${server.dataFolder}/${CLI_FOLDER}`;
  const versionFolder = `${cliFolder}/${request.version}`;
  const failure = await placeCliFiles(dependencies.logger, ports, request, {
    cliFolder,
    versionFolder,
  });
  return failure === undefined
    ? {
        kind: 'placed',
        placed: {
          node: `${server.nodeFolder}/node`,
          entry: `${versionFolder}/devcontainer.js`,
          preload: `${versionFolder}/${path.basename(request.client.preload)}`,
          editorModules: `${server.nodeFolder}/node_modules`,
        },
      }
    : {kind: 'failed', failure};
}
