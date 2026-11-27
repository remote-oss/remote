/**
 * @fileoverview The dev container CLI on a remote host: the editor's server there gives the `node` (found when a window
 * installed it, else installed with no start), and the pinned CLI and the preload are copied once for each version of
 * the extension into a folder of the server's data folder, whose last step is a rename, so that a folder that is there
 * is whole and a second run with the same version copies nothing. Before each run the placed files are hashed on the host
 * and compared with the hashes the extension was packaged with, never with hashes made from the files copied: a copy
 * that differs is placed again, and one that differs a second time fails the run. Everything goes over the host channel,
 * so the same steps serve any host that has one.
 */

import path from 'node:path';
import type {HostChannel, ScriptRequest} from 'lib-host';
import {CONTAINERS_CLI_FOLDER} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {cliNotPlaced} from '../connect/failures.ts';
import {
  installedServerOnHost,
  type ServerStepDependencies,
} from '../connect/server-steps.ts';
import type {Failed} from 'lib-authority';
import type {PlacedCli} from './cli-paths.ts';

/** The file that a whole folder holds, written before the folder gets its name. */
const WHOLE_MARKER = '.whole';

/** Prints `whole` when the folder of this version is there, else `missing`. */
const CHECK_SCRIPT = `if [ -f "$VERSION_FOLDER/${WHOLE_MARKER}" ]; then echo whole; else echo missing; fi\n`;

/**
 * Prints `sum=<sha256>` and the file's name, tab apart, for each file named in `FILES`, one to a line, that is in the
 * version's folder; the hash is empty for a file that is missing or that no tool of the host can hash.
 */
const HASH_SCRIPT = [
  'cd "$VERSION_FOLDER" || exit 1',
  'printf "%s\\n" "$FILES" | while IFS= read -r file; do',
  '  if command -v sha256sum >/dev/null 2>&1; then sum=$(sha256sum -- "$file" 2>/dev/null)',
  '  elif command -v shasum >/dev/null 2>&1; then sum=$(shasum -a 256 -- "$file" 2>/dev/null)',
  '  else sum=$(openssl dgst -sha256 -r -- "$file" 2>/dev/null); fi',
  '  printf "sum=%s\\t%s\\n" "${sum%% *}" "$file"',
  'done',
  '',
].join('\n');

/** Removes the folder of this version, for a copy that differs from the packaged one. */
const REMOVE_SCRIPT = 'rm -rf -- "$VERSION_FOLDER"\n';

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
 * ran at the same time, stays: the rename then puts the copy inside it, and the last line removes it from there.
 */
const PUBLISH_SCRIPT = [
  'set -e',
  `: > "$PART_FOLDER/${WHOLE_MARKER}"`,
  'mv -- "$PART_FOLDER" "$VERSION_FOLDER" 2>/dev/null || true',
  'rm -rf -- "$PART_FOLDER" "$VERSION_FOLDER/$(basename "$PART_FOLDER")"',
  `[ -f "$VERSION_FOLDER/${WHOLE_MARKER}" ]`,
  '',
].join('\n');

/** What the client has of the CLI to place. */
interface ClientCli {
  /** The folder of the pinned CLI on the client. */
  cliFolder: string;
  /** The preload's file on the client; it is placed as `cli-preload.js`. */
  preload: string;
  /**
   * The sha256 of every file to place, by its path under the version's folder, as the extension was packaged: the one
   * list of what is placed, and of what a host's copy must hold.
   */
  hashes: Readonly<Record<string, string>>;
}

/** The name the preload goes by in the hashes and on the host. */
const PRELOAD_NAME = 'cli-preload.js';

/** A sha256 as hexadecimal text. */
const SHA256 = /^[0-9a-f]{64}$/;

/** A path segment that stays in its folder: not empty, not `.`, and not `..`. */
function isSegment(part: string): boolean {
  return part !== '' && part !== '..' && part !== '.';
}

/** A name a file may have under the version's folder: relative, with no `..` segment, no empty one and no line break. */
function isPlacedName(name: string): boolean {
  return !name.includes('\n') && name.split('/').every(isSegment);
}

/** A version's folder name: one path segment that stays in the CLI's folder. */
function isVersionName(version: string): boolean {
  return (
    !version.includes('/') &&
    !version.includes('\\') &&
    !version.includes('\n') &&
    isSegment(version)
  );
}

/**
 * The hashes the extension was packaged with, from the text of its list: none when the text is no object, or holds a
 * name that could leave the version's folder or a value that is no sha256, so that nothing is placed from a list that
 * is not the packaged one.
 */
export function packagedHashesOf(
  text: string,
): Record<string, string> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const entries = Object.entries(parsed);
  return entries.length > 0 &&
    entries.every(
      ([name, hash]) =>
        isPlacedName(name) && typeof hash === 'string' && SHA256.test(hash),
    )
    ? Object.fromEntries(entries as Array<[string, string]>)
    : undefined;
}

/** What a placement is asked to do. */
export interface PlaceRequest {
  channel: HostChannel;
  /** The user whose server is installed, for its lock's name. */
  remoteUser: string;
  /** The version of the extension, which names the folder: another version is another folder. */
  version: string;
  client: ClientCli;
  /** Names a half-copied folder so that no other run's is the same. */
  newToken: () => string;
  onPhase(phase: 'installing'): void;
  onDownloadPercent(percent: number): void;
  cancellation: AbortSignal;
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

/** The files a request places: each name of the hashes, with the file on the client it is copied from. */
function filesOf(
  client: ClientCli,
): Array<{relative: string; localFile: string}> {
  return Object.keys(client.hashes).map(relative => ({
    relative,
    localFile:
      relative === PRELOAD_NAME
        ? client.preload
        : path.join(client.cliFolder, relative),
  }));
}

/**
 * Puts the CLI of the version in `folders` on the host of `request.channel`, copying nothing when its folder is there,
 * and checks the files there against the packaged hashes: a difference places the folder again, and a second one fails.
 * Undefined when the folder is there and as packaged at the end, else the failure, after the log says why.
 */
export async function placeCliFiles(
  logger: Logger,
  request: PlaceRequest,
  folders: CliFolders,
): Promise<Failed | undefined> {
  const {channel, cancellation} = request;
  const {cliFolder, versionFolder} = folders;
  if (
    path.posix.dirname(versionFolder) !== cliFolder ||
    !isVersionName(path.posix.basename(versionFolder))
  ) {
    logger.info(
      `the CLI's version folder ${versionFolder} is not a folder of its own under ${cliFolder}: nothing is placed`,
    );
    return cliNotPlaced();
  }
  const files = filesOf(request.client);

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

  /** Copies the files into a part folder and gives it the name of the version; the failure, after the log says why. */
  async function copiedWhole(): Promise<Failed | undefined> {
    const partFolder = `${versionFolder}.part-${request.newToken()}`;
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
      logger.info(
        `the CLI's folder on the host was not completed: ${published}`,
      );
      return cliNotPlaced();
    }
    return undefined;
  }

  /** The first file whose hash on the host is not the packaged one, and why; none when every file is as packaged. */
  async function differing(): Promise<string | undefined> {
    const hashed = new Map<string, string>();
    const outcome = await ranScript(
      HASH_SCRIPT,
      {FILES: files.map(file => file.relative).join('\n')},
      line => {
        const [field = '', name = ''] = line.split('\t');
        if (field.startsWith('sum=')) {
          hashed.set(name, field.slice('sum='.length));
        }
      },
    );
    if (outcome !== undefined) {
      return `the files could not be hashed on the host: ${outcome}`;
    }
    const wrong = files.find(
      file =>
        hashed.get(file.relative) !== request.client.hashes[file.relative],
    );
    if (wrong === undefined) {
      return undefined;
    }
    return hashed.get(wrong.relative) === ''
      ? `${wrong.relative} is missing on the host or cannot be hashed there`
      : `${wrong.relative} is not the file the extension was packaged with`;
  }

  for (const attempt of [1, 2]) {
    const looks: string[] = [];
    const whereabouts = await ranScript(CHECK_SCRIPT, {}, line => {
      looks.push(line);
    });
    if (whereabouts !== undefined) {
      logger.info(
        `the CLI's folder on the host was not checked: ${whereabouts}`,
      );
      return cliNotPlaced();
    }
    if (!looks.includes('whole')) {
      const failure = await copiedWhole();
      if (failure !== undefined) {
        return failure;
      }
    }
    const difference = await differing();
    if (difference === undefined) {
      return undefined;
    }
    logger.info(
      `the CLI on the host differs from the packaged one: ${difference}`,
    );
    if (attempt === 2) {
      return cliNotPlaced();
    }
    const removed = await ranScript(REMOVE_SCRIPT, {}, () => undefined);
    if (removed !== undefined) {
      logger.info(`the CLI's folder on the host was not removed: ${removed}`);
      return cliNotPlaced();
    }
  }
  return cliNotPlaced();
}

/**
 * Finds or installs the server's `node` on the host and puts the CLI of `request.version` beside it, copying nothing
 * when the folder of that version is there.
 */
export async function placeCli(
  dependencies: ServerStepDependencies,
  request: PlaceRequest,
): Promise<PlaceResult> {
  const server = await installedServerOnHost(dependencies, request);
  if (server.kind === 'failed') {
    return server;
  }
  const cliFolder = `${server.dataFolder}/${CONTAINERS_CLI_FOLDER}`;
  const versionFolder = `${cliFolder}/${request.version}`;
  const failure = await placeCliFiles(dependencies.logger, request, {
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
