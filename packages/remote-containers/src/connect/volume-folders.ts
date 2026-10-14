/**
 * @fileoverview C10's root step for the `vscode` volume (containers contracts §5.2): one fixed script, run as root,
 * makes each missing shared folder and opens it to every user, and leaves every folder that exists as it is.
 */

import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import {type ProductProfile, volumeServerFolder} from 'lib-product';
import {parseResult, RESULT_BEGIN, RESULT_END} from 'lib-server';

/** The platforms whose names may be a folder on the volume. */
const PLATFORM_FOLDER = /^[a-z0-9-]+$/;

/** The fixed script that makes each missing shared folder 0777 as root; its folders come in SHARED_FOLDER_1 to 3. */
export const VOLUME_FOLDERS_SCRIPT = [
  'set -u',
  'status=Ok',
  'created=',
  'failedPath=',
  'failedError=',
  'for folder in "$SHARED_FOLDER_1" "$SHARED_FOLDER_2" "$SHARED_FOLDER_3"; do',
  '  [ -e "$folder" ] && continue',
  '  if output=$(mkdir -- "$folder" 2>&1); then',
  '    if output=$(chmod 0777 -- "$folder" 2>&1); then',
  '      created="$created $folder"',
  '      continue',
  '    fi',
  '  elif [ -e "$folder" ]; then',
  '    continue',
  '  fi',
  '  if [ "$status" = Ok ]; then',
  '    status=CreateInstallDirFailed',
  '    failedPath=$folder',
  `    failedError=$(printf '%s' "$output" | tr '\\n' ' ')`,
  '  fi',
  'done',
  `printf '%s\\n' '${RESULT_BEGIN}' "status=$status" "server.created=\${created# }"`,
  'if [ -n "$failedPath" ]; then',
  `  printf '%s\\n' "server.writeFailedPath=$failedPath" "server.writeFailedError=$failedError"`,
  'fi',
  `printf '%s\\n' '${RESULT_END}'`,
  '',
].join('\n');

/** The volume's shared folders for `platform`, parents first (contracts §5.2); nothing for a platform that isn't a folder name. */
export function sharedFoldersOf(
  profile: ProductProfile,
  platform: string,
): readonly string[] | undefined {
  if (!PLATFORM_FOLDER.test(platform)) {
    return undefined;
  }
  const serverFolder = `/vscode/${volumeServerFolder(profile.applicationName)}`;
  return [
    serverFolder,
    `${serverFolder}/bin`,
    `${serverFolder}/bin/${platform}`,
  ];
}

/** The line that says the step did not run to its end. */
function notPrepared(reason: string): string {
  return `the volume's shared folders were not prepared: ${reason}`;
}

/** The one log line of a step whose script printed `lines` and exited with `status`. */
function outcomeLine(lines: readonly string[], status: number): string {
  const parsed = parseResult(lines);
  if ('failure' in parsed) {
    return notPrepared(`the root step gave no result (exit ${String(status)})`);
  }
  const {serverFacts} = parsed.block;
  if (parsed.block.status !== 'Ok') {
    return `the volume's shared folder ${serverFacts.writeFailedPath ?? ''} could not be made: ${serverFacts.writeFailedError ?? ''}`;
  }
  const created = (serverFacts.created ?? '')
    .split(' ')
    .filter(folder => folder !== '');
  return created.length === 0
    ? "the volume's shared folders all exist"
    : `the volume's shared folders were created: ${created.join(', ')}`;
}

/**
 * Runs the script over `rootChannel` for the folders of `platform`; it logs what happened and never fails the connect
 * (contracts §5.2).
 */
export async function prepareVolumeFolders(
  rootChannel: HostChannel,
  profile: ProductProfile,
  platform: string,
  logger: Logger,
  cancellation: AbortSignal,
): Promise<void> {
  const folders = sharedFoldersOf(profile, platform);
  if (folders === undefined) {
    logger.info(notPrepared(`the platform "${platform}" is not a folder name`));
    return;
  }
  const lines: string[] = [];
  const outcome = await rootChannel.runScript(
    {
      script: VOLUME_FOLDERS_SCRIPT,
      interpreter: 'posixShell',
      environment: Object.fromEntries(
        folders.map((folder, index) => [
          `SHARED_FOLDER_${String(index + 1)}`,
          folder,
        ]),
      ),
      input: {kind: 'text', text: ''},
      cancellation,
    },
    line => {
      lines.push(line);
    },
  );
  logger.info(
    outcome.kind === 'failed'
      ? notPrepared(`${outcome.failure.kind}: ${outcome.failure.detail}`)
      : outcomeLine(lines, outcome.status),
  );
}
