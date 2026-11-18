/**
 * @fileoverview The session bootstrap: the first bytes on the standard input of every
 * session whose commands `ShellRuns` writes. `sh` evaluates them as the remote command's prelude; they take the
 * environment the user's own login shell builds from its startup files, bounded, and then `exec` a POSIX `sh` that
 * reads the commands from the rest of the input, whatever the login shell is.
 */

import {
  type ConnectWaitSettings,
  connectWaitMilliseconds,
} from '../process/connect-wait.ts';
import {type Interpreter, type PlatformHint, posixQuote} from 'lib-host';
import {TUNNEL_COMMAND} from '../arguments/invocation.ts';
import {preludeProgram} from '../process/remote-program.ts';
import {
  interpreterOfPlatform,
  powershellSessionStart,
} from './powershell-session.ts';

/** The fewest and the most seconds the login shell's startup may take. */
const LAYER_ONE_SECONDS = {minimum: 1, maximum: 600} as const;

/**
 * What the login shell runs once its startup files are done: `export -p` into a file of its own, which a rename puts in
 * place only when the command has finished. The startup files write to another file that nothing reads, so nothing
 * they print can reach what the bootstrap evaluates.
 */
const WRITE_ENVIRONMENT = 'export -p >"$1.part" && mv "$1.part" "$1"';

/** The line that ends the session after `LAYER1-TIMEOUT`; a session that goes on without the login shell's environment leaves it out. */
const TIMEOUT_EXIT = '    exit 124';

/**
 * The script of the bootstrap. The user's login shell runs as a login shell on a command that writes the environment it
 * built to a file; a watchdog kills it after `LAYER1_SECONDS`. The session reaches `exec sh` unless the login shell
 * outlasts its bound or ends by itself without starting the command: it then prints one line, `LAYER1-TIMEOUT
 * <seconds>` or `LAYER1-EXITED <status>`, and ends, so the connect never goes on without the user's environment. Before
 * `exec sh` it prints `LAYER1-READY`: the connect is set up only when a reader has seen that line. Each of the three is
 * printed after a line end of its own, so that it is a line even when what came before wrote none.
 */
const SESSION_BOOTSTRAP_LINES: readonly string[] = [
  'LAYER1_DIR=$(mktemp -d 2>/dev/null) || LAYER1_DIR=',
  'if [ -n "$LAYER1_DIR" ] && [ -n "${SHELL:-}" ] && [ -x "$SHELL" ]; then',
  `  printf 'exec sh -c %s sh "%s"\\n' ${posixQuote(posixQuote(WRITE_ENVIRONMENT))} "$LAYER1_DIR/env" >"$LAYER1_DIR/in"`,
  '  if command -v setsid >/dev/null 2>&1; then',
  '    setsid "$SHELL" -l <"$LAYER1_DIR/in" >"$LAYER1_DIR/out" 2>"$LAYER1_DIR/err" &',
  '  else',
  '    "$SHELL" -l <"$LAYER1_DIR/in" >"$LAYER1_DIR/out" 2>"$LAYER1_DIR/err" &',
  '  fi',
  '  LAYER1_PID=$!',
  '  (',
  '    sleep "$LAYER1_SECONDS" &',
  '    LAYER1_SLEEP=$!',
  '    trap \'kill -9 "$LAYER1_SLEEP" 2>/dev/null; exit 0\' TERM',
  '    wait "$LAYER1_SLEEP"',
  '    : >"$LAYER1_DIR/timeout"',
  '    kill -9 -"$LAYER1_PID" "$LAYER1_PID" 2>/dev/null',
  '  ) >/dev/null 2>&1 </dev/null &',
  '  LAYER1_WATCH=$!',
  '  wait "$LAYER1_PID" 2>/dev/null',
  '  LAYER1_STATUS=$?',
  '  kill -TERM "$LAYER1_WATCH" 2>/dev/null',
  '  wait "$LAYER1_WATCH" 2>/dev/null',
  '  kill -9 -"$LAYER1_PID" 2>/dev/null',
  '  if [ -f "$LAYER1_DIR/env" ]; then',
  '    eval "$(cat "$LAYER1_DIR/env")"',
  '    LAYER1_B64=',
  "    if [ \"$(printf 'x' | base64 -w0 2>/dev/null)\" = 'eA==' ]; then",
  "      LAYER1_B64='base64 -w0'",
  "    elif [ \"$(printf 'x' | base64 -n 2>/dev/null)\" = 'eA==' ]; then",
  "      LAYER1_B64='base64 -n'",
  '    fi',
  '    LAYER1_PRINTED=0',
  '    LAYER1_CUT=0',
  '    if [ -n "$LAYER1_B64" ]; then',
  '      if [ -f "$LAYER1_DIR/out" ]; then',
  '        while IFS= read -r LAYER1_LINE || [ -n "$LAYER1_LINE" ]; do',
  '          if [ "$LAYER1_PRINTED" -lt 1000 ]; then',
  '            printf \'LAYER1-OUT %s\\n\' "$(printf \'%s\' "$LAYER1_LINE" | $LAYER1_B64)"',
  '            LAYER1_PRINTED=$((LAYER1_PRINTED + 1))',
  '          else',
  '            LAYER1_CUT=$((LAYER1_CUT + 1))',
  '          fi',
  '        done < "$LAYER1_DIR/out"',
  '      fi',
  '      if [ -f "$LAYER1_DIR/err" ]; then',
  '        while IFS= read -r LAYER1_LINE || [ -n "$LAYER1_LINE" ]; do',
  '          if [ "$LAYER1_PRINTED" -lt 1000 ]; then',
  '            printf \'LAYER1-ERR %s\\n\' "$(printf \'%s\' "$LAYER1_LINE" | $LAYER1_B64)"',
  '            LAYER1_PRINTED=$((LAYER1_PRINTED + 1))',
  '          else',
  '            LAYER1_CUT=$((LAYER1_CUT + 1))',
  '          fi',
  '        done < "$LAYER1_DIR/err"',
  '      fi',
  '      [ "$LAYER1_CUT" -gt 0 ] && printf \'LAYER1-OUTPUT-CUT %s\\n\' "$LAYER1_CUT"',
  '    elif [ -s "$LAYER1_DIR/out" ] || [ -s "$LAYER1_DIR/err" ]; then',
  "      printf 'LAYER1-OUTPUT-SKIPPED no-base64\\n'",
  '    fi',
  '  elif [ -e "$LAYER1_DIR/timeout" ]; then',
  '    rm -rf "$LAYER1_DIR"',
  '    printf \'\\nLAYER1-TIMEOUT %s\\n\' "$LAYER1_SECONDS"',
  TIMEOUT_EXIT,
  '  else',
  '    rm -rf "$LAYER1_DIR"',
  '    printf \'\\nLAYER1-EXITED %s\\n\' "$LAYER1_STATUS"',
  '    exit 1',
  '  fi',
  'fi',
  '[ -n "$LAYER1_DIR" ] && rm -rf "$LAYER1_DIR"',
  'unset LAYER1_DIR LAYER1_PID LAYER1_WATCH LAYER1_STATUS LAYER1_SECONDS LAYER1_B64 LAYER1_LINE LAYER1_PRINTED LAYER1_CUT',
  "printf '\\nLAYER1-READY\\n'",
  'exec sh',
];

/** The lines of the bootstrap: when the login shell outlasts its bound, `exit` the session, or go on to `exec sh` after the report. */
function bootstrapLines(goesOnAfterTimeout: boolean): readonly string[] {
  return goesOnAfterTimeout
    ? SESSION_BOOTSTRAP_LINES.filter(line => line !== TIMEOUT_EXIT)
    : SESSION_BOOTSTRAP_LINES;
}

/** The remote command of a session that `ShellRuns` writes to, and the prelude written before any of its commands. */
export function sessionStart(
  layerOneSeconds: number,
  goesOnAfterTimeout = false,
): {
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
  const prelude = `LAYER1_SECONDS=${String(layerOneSeconds)}\n${bootstrapLines(goesOnAfterTimeout).join('\n')}\n`;
  return {
    remoteProgram: preludeProgram(Buffer.byteLength(prelude, 'utf8')),
    prelude,
  };
}

/**
 * The session start for a connect wait: the login shell may take as long as the connect wait itself, in whole seconds,
 * rounded up, at least 1 and at most the ceiling; a host's own 0 takes the ceiling the wait names. A host decided as
 * Windows gets the PowerShell loop instead; every other platform gets the POSIX bootstrap.
 */
export function sessionStartFor(
  settings: ConnectWaitSettings,
  goesOnAfterTimeout = false,
  platform: PlatformHint = 'unknown',
): {
  remoteProgram: string;
  prelude: string;
} {
  if (platform === 'windows') {
    return powershellSessionStart();
  }
  const seconds = connectWaitMilliseconds(settings) / 1000;
  return sessionStart(
    Math.min(
      LAYER_ONE_SECONDS.maximum,
      Math.max(LAYER_ONE_SECONDS.minimum, Math.ceil(seconds)),
    ),
    goesOnAfterTimeout,
  );
}

/**
 * The start of the connection's session: `start` as it is, or, with the host's RemoteCommand in effect, no remote
 * program (ssh refuses one beside it) and the program as the first line of the prelude, which the shell the
 * RemoteCommand starts reads from standard input: `exec <program>` on POSIX, the program's line alone on Windows,
 * whose shells have no `exec`.
 */
export function connectionStart(
  start: {remoteProgram: string; prelude: string},
  remoteCommandInEffect: boolean,
  platform: PlatformHint = 'unknown',
): {remoteProgram: string | undefined; prelude: string} {
  if (!remoteCommandInEffect) {
    return start;
  }
  const line =
    platform === 'windows'
      ? start.remoteProgram
      : `exec ${start.remoteProgram}`;
  return {remoteProgram: undefined, prelude: `${line}\n${start.prelude}`};
}

/**
 * How the connection's session opens. A known platform has its remote program, and its prelude written once ssh
 * reports the login. An unknown one has no remote program: the host's own shell reads the platform probe, and the
 * answers choose the line that goes on, the PowerShell loop's line on Windows, or on POSIX a line that prints the
 * hand-over line and starts `program`, the bootstrap's reader, whose prelude is written only once that line is back, so
 * that no shell that reads its input ahead can take it.
 */
export type SessionOpening =
  | {kind: 'known'; prelude: string; interpreter: Interpreter}
  | {
      kind: 'detect';
      posix: {program: string; prelude: string};
      windows: {line: string};
    };

/**
 * The remote program and the opening of the connection's session: a known platform's start as `connectionStart` gives
 * it; with the platform unknown, no remote program and the opening that detects it, whether or not the host's
 * RemoteCommand is in effect, since either way a shell reads the session's input.
 */
export function sessionOpeningFor(
  settings: ConnectWaitSettings,
  remoteCommandInEffect: boolean,
  platform: PlatformHint,
): {remoteProgram: string | undefined; opening: SessionOpening} {
  if (platform !== 'unknown') {
    const start = connectionStart(
      sessionStartFor(settings, false, platform),
      remoteCommandInEffect,
      platform,
    );
    return {
      remoteProgram: start.remoteProgram,
      opening: {
        kind: 'known',
        prelude: start.prelude,
        interpreter: interpreterOfPlatform(platform),
      },
    };
  }
  const posix = sessionStartFor(settings, false, 'unknown');
  return {
    remoteProgram: undefined,
    opening: {
      kind: 'detect',
      posix: {program: posix.remoteProgram, prelude: posix.prelude},
      windows: {line: `${powershellSessionStart().remoteProgram}\n`},
    },
  };
}

/**
 * The start of the tunnel `ssh`: its fixed command as the remote program, or, with the host's RemoteCommand in effect,
 * no remote program (ssh refuses one beside it) and the command as one line for the shell the RemoteCommand starts to
 * read from its input.
 */
export function tunnelStart(remoteCommandInEffect: boolean): {
  remoteProgram?: string;
  input?: string;
} {
  return remoteCommandInEffect
    ? {input: `exec sh -c ${posixQuote(TUNNEL_COMMAND)}\n`}
    : {remoteProgram: TUNNEL_COMMAND};
}

/** What the first lines of a session's output say about the bootstrap. */
export type BootstrapEvent =
  | {kind: 'ready'}
  | {kind: 'timeout'; seconds: number}
  | {kind: 'exited'; status: number};

const BOOTSTRAP_LINE = /^LAYER1-(READY|TIMEOUT (\d+)|EXITED (\d+))\r?$/;

/**
 * The profile lines the bootstrap prints for the login shell's startup output, or none: an encoded line of the
 * startup's standard output or standard error, the report that the cut dropped lines, or the report that no
 * base64 could encode them.
 */
export type ProfileLine =
  | {kind: 'out'; text: string}
  | {kind: 'err'; text: string}
  | {kind: 'cut'; dropped: number}
  | {kind: 'skipped'};

/**
 * The whole of a base64 token: the alphabet, the padding, and a length of four, so that a line that only looks
 * like an encoded one is not taken for one.
 */
const PROFILE_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The profile line of `line`, or none: the token is decoded, so that a startup line that looks like one of ours
 * is seen only inside its `LAYER1-OUT` line.
 */
export function profileLineOf(line: string): ProfileLine | undefined {
  const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
  const stream = bare.startsWith('LAYER1-OUT ')
    ? ('out' as const)
    : bare.startsWith('LAYER1-ERR ')
      ? ('err' as const)
      : undefined;
  if (stream !== undefined) {
    const token = bare.slice('LAYER1-OUT '.length);
    if (token.length % 4 === 0 && PROFILE_BASE64.test(token)) {
      return {
        kind: stream,
        text: Buffer.from(token, 'base64').toString('utf8'),
      };
    }
    return undefined;
  }
  const match = /^LAYER1-OUTPUT-CUT (\d+)$/.exec(bare);
  if (match !== null) {
    return {kind: 'cut', dropped: Number(match[1])};
  }
  if (bare === 'LAYER1-OUTPUT-SKIPPED no-base64') {
    return {kind: 'skipped'};
  }
  return undefined;
}

/** The event a line of a session's output reports, or none for any other line. */
export function bootstrapEventOf(line: string): BootstrapEvent | undefined {
  const match = BOOTSTRAP_LINE.exec(line);
  if (match === null) {
    return undefined;
  }
  if (match[2] !== undefined) {
    return {kind: 'timeout', seconds: Number(match[2])};
  }
  if (match[3] !== undefined) {
    return {kind: 'exited', status: Number(match[3])};
  }
  return {kind: 'ready'};
}

/** The line the log gets for an event that ends the session before it was ready. */
export function bootstrapLogLine(
  event: Exclude<BootstrapEvent, {kind: 'ready'}>,
): string {
  return event.kind === 'timeout'
    ? `the login shell did not finish its startup within ${String(event.seconds)} s`
    : `the SSH session ended before the host reported its platform: the login shell's startup exited with status ${String(event.status)}`;
}
