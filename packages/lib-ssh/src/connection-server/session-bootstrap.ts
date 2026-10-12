/**
 * @fileoverview The session bootstrap: the first bytes on the standard input of every
 * session whose commands `ShellRuns` writes. `sh` evaluates them as the remote command's prelude; they take the
 * environment the user's own login shell builds from its startup files, bounded, and then `exec` a POSIX `sh` that
 * reads the commands from the rest of the input, whatever the login shell is.
 */

import type {ConnectWaitSettings} from '../process/connect-wait.ts';
import {preludeProgram} from '../process/remote-program.ts';

/** The fewest and the most seconds the login shell's startup may take. */
const LAYER_ONE_SECONDS = {minimum: 1, maximum: 600} as const;

/**
 * The script of the bootstrap. The user's login shell runs as a login shell on a command that prints the environment it
 * built; a watchdog kills it after `LAYER1_SECONDS`, and the session always reaches `exec sh`.
 */
const SESSION_BOOTSTRAP_LINES: readonly string[] = [
  'LAYER1_DIR=$(mktemp -d 2>/dev/null) || LAYER1_DIR=',
  'if [ -n "$LAYER1_DIR" ] && [ -n "${SHELL:-}" ] && [ -x "$SHELL" ]; then',
  '  printf \'%s\\n\' \'exec sh -c "echo LAYER1-START; export -p" </dev/null\' >"$LAYER1_DIR/in"',
  '  if command -v setsid >/dev/null 2>&1; then',
  '    setsid "$SHELL" -l <"$LAYER1_DIR/in" >"$LAYER1_DIR/out" 2>/dev/null &',
  '  else',
  '    "$SHELL" -l <"$LAYER1_DIR/in" >"$LAYER1_DIR/out" 2>/dev/null &',
  '  fi',
  '  LAYER1_PID=$!',
  '  (',
  '    sleep "$LAYER1_SECONDS" &',
  '    LAYER1_SLEEP=$!',
  '    trap \'kill -9 "$LAYER1_SLEEP" 2>/dev/null; exit 0\' TERM',
  '    wait "$LAYER1_SLEEP"',
  '    kill -9 -"$LAYER1_PID" "$LAYER1_PID" 2>/dev/null',
  '  ) >/dev/null 2>&1 </dev/null &',
  '  LAYER1_WATCH=$!',
  '  wait "$LAYER1_PID" 2>/dev/null',
  '  kill -TERM "$LAYER1_WATCH" 2>/dev/null',
  '  wait "$LAYER1_WATCH" 2>/dev/null',
  '  kill -9 -"$LAYER1_PID" 2>/dev/null',
  '  eval "$(sed -n \'/^LAYER1-START$/,$p\' "$LAYER1_DIR/out" | sed 1d)"',
  'fi',
  '[ -n "$LAYER1_DIR" ] && rm -rf "$LAYER1_DIR"',
  'unset LAYER1_DIR LAYER1_PID LAYER1_WATCH LAYER1_SECONDS',
  'exec sh',
];

/** The remote command of a session that `ShellRuns` writes to, and the prelude written before any of its commands. */
export function sessionStart(layerOneSeconds: number): {
  remoteProgram: string;
  prelude: string;
} {
  if (
    !Number.isInteger(layerOneSeconds) ||
    layerOneSeconds < LAYER_ONE_SECONDS.minimum ||
    layerOneSeconds > LAYER_ONE_SECONDS.maximum
  ) {
    throw new RangeError(
      `the login shell's bound is a whole number of seconds from ${String(LAYER_ONE_SECONDS.minimum)} to ${String(LAYER_ONE_SECONDS.maximum)}, not ${String(layerOneSeconds)}`,
    );
  }
  const prelude = `LAYER1_SECONDS=${String(layerOneSeconds)}\n${SESSION_BOOTSTRAP_LINES.join('\n')}\n`;
  return {
    remoteProgram: preludeProgram(Buffer.byteLength(prelude, 'utf8')),
    prelude,
  };
}

/**
 * The session start for a connect wait: the login shell may take as long as the connect timeout, in whole seconds,
 * rounded up, at least 1 and at most the ceiling; a host's own 0 takes the ceiling the wait names.
 */
export function sessionStartFor(settings: ConnectWaitSettings): {
  remoteProgram: string;
  prelude: string;
} {
  const seconds =
    settings.connectTimeoutSeconds === 0 && settings.fromHost
      ? settings.unboundedWaitSeconds
      : settings.connectTimeoutSeconds;
  return sessionStart(
    Math.min(
      LAYER_ONE_SECONDS.maximum,
      Math.max(LAYER_ONE_SECONDS.minimum, Math.ceil(seconds)),
    ),
  );
}
