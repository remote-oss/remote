/**
 * @fileoverview A stand-in for the editor's server, for the acceptance tests of the server lifecycle: an archive with
 * the layout of a real server archive (one top folder, a launcher in it) whose launcher is a POSIX script that
 * records the options it was started with, prints the ready line the start step waits for, and stays until it is
 * killed. The lifecycle scripts cannot tell it from a server, and the tests need no download.
 */

import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {type ArchiveFile, tarGzip} from './tar-archive.ts';

/** The launcher's path inside an installed server folder, as the lifecycle's script parameters name it. */
export const STAND_IN_LAUNCHER = 'bin/stand-in-server';

/** The folder every file of the archive is in, as in the archives the editor publishes. */
const TOP_FOLDER = 'stand-in-server-linux';

/** The first line the launcher prints for each option it was given, so that a test reads them back from the log. */
export const OPTION_LINE_PREFIX = 'option: ';

/** How the stand-in server behaves once started. */
export type StandInBehaviour =
  'serving' | 'crashing' | 'missingLibraries' | 'silent';

/** The exit status with which a server reports that the host lacks libraries it needs. */
const MISSING_LIBRARIES_STATUS = 207;

/** The launcher of a server that serves: lists its options, takes a range's lower end as its port or picks one for 0. */
const SERVING_LAUNCHER = [
  '#!/bin/sh',
  'PORT=0',
  'for OPTION in "$@"; do',
  `  printf '%s%s\\n' '${OPTION_LINE_PREFIX}' "$OPTION"`,
  'done',
  'while [ "$#" -gt 0 ]; do',
  '  case $1 in',
  '    --port) PORT=$2; shift ;;',
  '  esac',
  '  shift',
  'done',
  'PORT=${PORT%%-*}',
  'if [ "$PORT" = 0 ]; then',
  "  PORT=$(awk 'BEGIN { srand(); print int(20000 + rand() * 20000) }')",
  'fi',
  'echo "Extension host agent listening on $PORT"',
  'while :; do',
  '  sleep 1',
  'done',
  '',
].join('\n');

/** The launcher of each behaviour. */
const LAUNCHERS: Readonly<Record<StandInBehaviour, string>> = {
  serving: SERVING_LAUNCHER,
  crashing: '#!/bin/sh\necho "stand-in server crashed" >&2\nexit 1\n',
  missingLibraries: `#!/bin/sh\nexit ${String(MISSING_LIBRARIES_STATUS)}\n`,
  silent: '#!/bin/sh\nwhile :; do\n  sleep 1\ndone\n',
};

/** The files of the stand-in server archive. */
function standInFiles(behaviour: StandInBehaviour): ArchiveFile[] {
  return [
    {
      path: `${TOP_FOLDER}/${STAND_IN_LAUNCHER}`,
      content: LAUNCHERS[behaviour],
      mode: 0o755,
    },
    {
      path: `${TOP_FOLDER}/product.json`,
      content: '{"commit": "stand-in"}\n',
      mode: 0o644,
    },
  ];
}

/** How the entries of the archive are named: inside a wrapper folder, or from `./` with no folder around them. */
export type StandInLayout = 'wrapped' | 'rooted';

/** Writes the stand-in server archive of a behaviour to `file`. */
export function writeStandInArchive(
  file: string,
  behaviour: StandInBehaviour = 'serving',
  layout: StandInLayout = 'wrapped',
): void {
  const files = standInFiles(behaviour).map(entry => ({
    ...entry,
    path:
      layout === 'wrapped'
        ? entry.path
        : `./${entry.path.slice(TOP_FOLDER.length + 1)}`,
  }));
  writeFileSync(file, tarGzip(files));
}

/** The archive's path inside `folder`, named like the archives the editor downloads. */
export function standInArchivePath(folder: string): string {
  return path.join(folder, 'stand-in-server.tar.gz');
}
