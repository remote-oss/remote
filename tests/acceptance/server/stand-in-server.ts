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
  | 'serving'
  | 'listening'
  | 'crashing'
  | 'requirementsUnmet'
  | 'helperUnrunnable'
  | 'silent'
  | 'readyThenExit'
  | 'noFreePort'
  | 'cveTerminated';

/** The two lines the requirements helper of the `requirementsUnmet` stand-in prints before it exits 99. */
export const REQUIREMENTS_LINES = [
  'Warning: Missing GLIBC >= 2.28! from /lib/libc.so',
  'Error: Missing required dependencies.',
];

/** The launcher's lines up to and including the ready line; the serving and listening behaviours share them and differ only in the last part. */
const SERVING_LINES = [
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
  '  PORT=$(( 20000 + $(od -An -N2 -tu2 /dev/urandom) % 20000 ))',
  'fi',
  'echo "Extension host agent listening on $PORT"',
];

/** The launcher of a server that serves: lists its options, takes a range's lower end as its port or picks one for 0. */
const SERVING_LAUNCHER = [
  ...SERVING_LINES,
  'while :; do',
  '  sleep 1',
  'done',
  '',
].join('\n');

/**
 * The launcher that listens: the same ready line, then a port that echoes what it is sent, until killed. BusyBox's
 * full nc (Alpine's nc) keeps listening on loopback; where nc is another one (OpenBSD's, on Ubuntu, which runs no
 * program per connection), the host's busybox does it with its own persistent listener, which binds every address.
 */
const LISTENING_LAUNCHER = [
  ...SERVING_LINES,
  'case $(readlink -f "$(command -v nc)") in',
  '  */busybox) nc -lk -p "$PORT" -s 127.0.0.1 -e /bin/cat & ;;',
  '  *) busybox nc -ll -p "$PORT" -e /bin/cat & ;;',
  'esac',
  'wait',
  '',
].join('\n');

/** The launcher of each behaviour. */
const LAUNCHERS: Readonly<Record<StandInBehaviour, string>> = {
  serving: SERVING_LAUNCHER,
  listening: LISTENING_LAUNCHER,
  crashing: '#!/bin/sh\necho "stand-in server crashed" >&2\nexit 1\n',
  requirementsUnmet: SERVING_LAUNCHER,
  helperUnrunnable: SERVING_LAUNCHER,
  silent: '#!/bin/sh\nwhile :; do\n  sleep 1\ndone\n',
  readyThenExit:
    '#!/bin/sh\necho "Extension host agent listening on 24680"\nexit 0\n',
  noFreePort:
    '#!/bin/sh\necho "--port: Could not find free port in range: 1 - 2 (inclusive)." >&2\nexit 1\n',
  cveTerminated:
    '#!/bin/sh\necho "* !!!! Server terminated due to presence of CVE-2020-1416 !!!!"\nexit 0\n',
};

/** The requirements helper of the behaviours that have one: `serving` accepts the host, `requirementsUnmet` refuses it, `helperUnrunnable` cannot run. */
const HELPERS: Readonly<Partial<Record<StandInBehaviour, string>>> = {
  serving: '#!/bin/sh\nexit 0\n',
  requirementsUnmet: `#!/bin/sh\n${REQUIREMENTS_LINES.map(line => `echo '${line}'`).join('\n')}\nexit 99\n`,
  helperUnrunnable: '#!/bin/sh\nexit 127\n',
};

/** The files of the stand-in server archive. */
function standInFiles(behaviour: StandInBehaviour): ArchiveFile[] {
  const helper = HELPERS[behaviour];
  return [
    ...(helper === undefined
      ? []
      : [
          {
            path: `${TOP_FOLDER}/bin/helpers/check-requirements.sh`,
            content: helper,
            mode: 0o755,
          },
        ]),
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
