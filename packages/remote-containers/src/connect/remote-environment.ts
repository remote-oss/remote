/**
 * @fileoverview The remote environment of one connection: the mode of `userEnvProbe`, the probe script, the
 * environment it prints and its merge with `remoteEnv`.
 */

/** How `userEnvProbe` starts the remote user's shell. */
export type ProbeMode =
  'none' | 'loginShell' | 'interactiveShell' | 'loginInteractiveShell';

const BEGIN_MARKER = 'remote-oss-env-probe-begin';
const END_MARKER = 'remote-oss-env-probe-end';

const MODE_FLAGS: Readonly<Record<Exclude<ProbeMode, 'none'>, string>> = {
  loginShell: '-l -c',
  interactiveShell: '-i -c',
  loginInteractiveShell: '-l -i -c',
};

/** The mode the merged configuration names; `loginInteractiveShell` when it names none or an unknown one. */
export function probeModeOf(
  merged: Readonly<Record<string, unknown>> | undefined,
): ProbeMode {
  const mode = merged?.userEnvProbe;
  return mode === 'none' || mode === 'loginShell' || mode === 'interactiveShell'
    ? mode
    : 'loginInteractiveShell';
}

/** The `remoteEnv` entries that are strings or null; the names of the others, for the log. */
export function remoteEnvironmentOf(
  merged: Readonly<Record<string, unknown>> | undefined,
): {
  entries: Readonly<Record<string, string | null>>;
  dropped: readonly string[];
} {
  const written = merged?.remoteEnv;
  const entries: Record<string, string | null> = {};
  const dropped: string[] = [];
  if (typeof written !== 'object' || written === null) {
    return {entries, dropped};
  }
  for (const [name, value] of Object.entries(
    written as Record<string, unknown>,
  )) {
    if (typeof value === 'string' || value === null) {
      entries[name] = value;
    } else {
      dropped.push(name);
    }
  }
  return {entries, dropped};
}

/** The probe script for a mode that starts a shell (§1 step 2). */
export function probeScriptOf(mode: Exclude<ProbeMode, 'none'>): string {
  const command = `printf '%s\\n' ${BEGIN_MARKER}; cat /proc/self/environ; printf '\\n%s\\n' ${END_MARKER}`;
  return [
    'user="$(id -un)"',
    'entry=""',
    'if command -v getent >/dev/null 2>&1; then entry="$(getent passwd "$user")"; fi',
    'if [ -z "$entry" ] && [ -r /etc/passwd ]; then',
    '  while IFS= read -r line; do',
    '    case "$line" in "$user":*) entry="$line"; break;; esac',
    '  done < /etc/passwd',
    'fi',
    'shell="$(printf \'%s\\n\' "$entry" | cut -d: -f7)"',
    '[ -n "$shell" ] || shell=/bin/sh',
    `exec "$shell" ${MODE_FLAGS[mode]} "${command}"`,
    '',
  ].join('\n');
}

/** The environment between the probe's whole-line markers, or undefined when the end marker is missing. */
export function probedEnvironmentOf(
  stdout: string,
): Readonly<Record<string, string>> | undefined {
  const begin = `${BEGIN_MARKER}\n`;
  const beginAt = stdout.startsWith(begin)
    ? 0
    : stdout.indexOf(`\n${begin}`) + 1;
  if (beginAt === 0 && !stdout.startsWith(begin)) {
    return undefined;
  }
  const bodyAt = beginAt + begin.length;
  const endLine = `\n${END_MARKER}`;
  let endAt = stdout.indexOf(endLine, bodyAt - 1);
  while (
    endAt !== -1 &&
    stdout.length > endAt + endLine.length &&
    stdout[endAt + endLine.length] !== '\n'
  ) {
    endAt = stdout.indexOf(endLine, endAt + 1);
  }
  if (endAt === -1) {
    return undefined;
  }
  const environment: Record<string, string> = {};
  for (const entry of stdout
    .slice(bodyAt, Math.max(endAt, bodyAt))
    .split('\0')) {
    const equals = entry.indexOf('=');
    if (equals > 0) {
      environment[entry.slice(0, equals)] = entry.slice(equals + 1);
    }
  }
  return environment;
}

/** The extension host's environment: the probe's, with `remoteEnv` over it (BR-11a). */
export function extensionHostEnvironmentOf(
  probed: Readonly<Record<string, string>> | undefined,
  remoteEnv: Readonly<Record<string, string | null>>,
): Readonly<Record<string, string | null>> {
  return {...probed, ...remoteEnv};
}
