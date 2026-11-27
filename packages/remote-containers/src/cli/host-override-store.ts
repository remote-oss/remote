/**
 * @fileoverview The override file on a remote host: the configuration text the pre-pass rewrote is written there, over
 * the host channel, where only the host's user can read it (it may hold substituted environment values), and removed
 * after the run. The text goes on the script's standard input, never in an argument. The folder is the one the host's
 * runtime folder names when it sets one, else a folder of the user's own under its temporary folder; a folder that is
 * not a directory of the user's alone is refused.
 */

import type {HostChannel, ScriptRequest} from 'lib-host';
import type {OverrideStore} from './override-files.ts';

/** The line the writing script prints with the file's path, which no other line of it starts with. */
const WRITTEN_PREFIX = 'override=';

/**
 * Writes standard input to a file of the name `OVERRIDE_NAME` in the user's override folder, made when it is missing,
 * and prints the file's path. The mask leaves the folders to the user alone and the file to the user's reading and
 * writing; a folder the user does not own alone is no place for the text.
 */
const WRITE_SCRIPT = [
  'set -e',
  'umask 077',
  'base="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}/remote-oss-$(id -u)}"',
  'folder="$base/cli-overrides"',
  'mkdir -p "$folder"',
  'for checked in "$base" "$folder"; do',
  '  [ -n "$(find "$checked" -maxdepth 0 -type d -user "$(id -un)" -perm 700 2>/dev/null)" ] || { echo "the folder $checked is not a directory of the user alone" >&2; exit 1; }',
  'done',
  'file="$folder/$OVERRIDE_NAME.json"',
  'cat > "$file"',
  `printf '${WRITTEN_PREFIX}%s\\n' "$file"`,
  '',
].join('\n');

/** Removes the file named by `OVERRIDE_FILE`; one that is not there is not an error. */
const REMOVE_SCRIPT = 'rm -f -- "$OVERRIDE_FILE"\n';

/** Why `outcome` is no success, for the error a store gives; undefined for a script that exited with status 0. */
function failureOf(
  outcome: Awaited<ReturnType<HostChannel['runScript']>>,
): string | undefined {
  if (outcome.kind === 'failed') {
    return outcome.failure.detail;
  }
  return outcome.status === 0
    ? undefined
    : `the script on the host ended with status ${String(outcome.status)}`;
}

/** The store on the host of `channel`; `newName` gives each file a name no other has, and `cancellation` ends a call. */
export function hostOverrideStoreOf(
  channel: HostChannel,
  newName: () => string,
  cancellation: AbortSignal,
): OverrideStore {
  /** The request of a script that reads `input` and runs with `environment`. */
  function requestOf(
    script: string,
    environment: Record<string, string>,
    input: ScriptRequest['input'],
  ): ScriptRequest {
    return {
      script,
      interpreter: 'posixShell',
      environment,
      input,
      cancellation,
    };
  }
  return {
    write: async text => {
      let written: string | undefined;
      const outcome = await channel.runScript(
        requestOf(
          WRITE_SCRIPT,
          {OVERRIDE_NAME: newName()},
          {kind: 'text', text},
        ),
        line => {
          if (line.startsWith(WRITTEN_PREFIX)) {
            written = line.slice(WRITTEN_PREFIX.length);
          }
        },
      );
      const failure = failureOf(outcome);
      if (failure !== undefined || written === undefined) {
        throw new Error(
          `the override file was not written on the host: ${failure ?? 'the script gave no path'}`,
        );
      }
      return written;
    },
    remove: async file => {
      const failure = failureOf(
        await channel.runScript(
          requestOf(
            REMOVE_SCRIPT,
            {OVERRIDE_FILE: file},
            {kind: 'text', text: ''},
          ),
          () => undefined,
        ),
      );
      if (failure !== undefined) {
        throw new Error(
          `the override file was not removed on the host: ${failure}`,
        );
      }
    },
  };
}
