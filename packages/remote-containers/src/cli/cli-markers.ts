/**
 * @fileoverview Whether the lifecycle commands the blocking run would run in a container that was already running have
 * run already, read from the markers the dev container CLI itself consults (`[devcontainers-cli]` 0.89.0, the functions
 * `yd` and `kN` of its bundled `devContainersSpecCLI.js` for the marker file and its comparison, and `SN` for the
 * container's creation time). The CLI keeps one file for each command, `<user data folder>/.<command>Marker`, where the
 * user data folder is `.devcontainer` under the remote user's home folder. It runs the command when the file's text
 * differs from the container's creation time (`.Created`), and writes that time into it. A read of the markers writes
 * nothing; a verdict of `ran` needs every marker the commands need to hold the creation time exactly, and anything else
 * gives `run`: a missing or unreadable file, a home folder that is in doubt, a command no rule here covers, an exec that
 * failed.
 */

import type {HostChannel} from 'lib-host';

/** The commands whose markers are read: the ones the blocking run runs up to the default `waitFor`, in the CLI's order. */
const BLOCKING_COMMANDS = ['onCreateCommand', 'updateContentCommand'] as const;

/** The `waitFor` values that stop before any command that has a marker here, so that nothing needs one. */
const NOTHING_BLOCKS = new Set(['initializeCommand']);

/** The `waitFor` values that block on the commands listed, each with the commands it runs. */
const BLOCKS_ON: Readonly<Record<string, number>> = {
  onCreateCommand: 1,
  updateContentCommand: 2,
};

/** The line the script prints when every marker it was asked about holds the creation time. */
const RAN_LINE = 'markers:ran';

/** The fixed script: its inputs come in `MARKER_USER`, `MARKER_ENV_HOME`, `MARKER_CREATED` and `MARKER_NAMES`. */
export const MARKERS_SCRIPT = [
  'set -u',
  'home=$(getent passwd "$MARKER_USER" 2>/dev/null | cut -d: -f6)',
  'if [ -z "$home" ]; then',
  `  home=$(awk -F: -v user="$MARKER_USER" '$1 == user {print $6}' /etc/passwd 2>/dev/null)`,
  'fi',
  'if [ -n "$MARKER_ENV_HOME" ] && [ "$MARKER_ENV_HOME" != "$home" ]; then exit 0; fi',
  '[ -n "$home" ] || exit 0',
  'for name in $MARKER_NAMES; do',
  '  text=$(cat "$home/.devcontainer/.${name}Marker" 2>/dev/null) || exit 0',
  '  [ "$text" = "$MARKER_CREATED" ] || exit 0',
  'done',
  `printf '%s\\n' '${RAN_LINE}'`,
  '',
].join('\n');

/**
 * The markers the blocking run's commands need, from the merged configuration `up` gave: the commands up to its
 * `waitFor` (the default `updateContentCommand`) that have an entry. None when the configuration says nothing that
 * blocks; undefined for a `waitFor` this reading does not cover, which means the run happens.
 */
export function markersNeeded(
  merged: Readonly<Record<string, unknown>> | undefined,
): readonly string[] | undefined {
  if (merged === undefined) {
    return undefined;
  }
  const waitFor = merged.waitFor ?? 'updateContentCommand';
  if (typeof waitFor !== 'string') {
    return undefined;
  }
  if (NOTHING_BLOCKS.has(waitFor)) {
    return [];
  }
  const blocking = BLOCKS_ON[waitFor];
  if (blocking === undefined) {
    return undefined;
  }
  return BLOCKING_COMMANDS.slice(0, blocking).filter(command => {
    const entries = merged[`${command}s`];
    return Array.isArray(entries) && entries.length > 0;
  });
}

/** What the markers of a container say of its blocking commands. */
export interface MarkerFacts {
  /** The user the commands run as, the container's remote user. */
  user: string;
  /** The `HOME` of the container's environment, when it sets one. */
  environmentHome: string | undefined;
  /** The container's creation time, `.Created`, as the CLI compares it. */
  created: string;
  /** The markers to read, from `markersNeeded`. */
  names: readonly string[];
}

/**
 * Whether every marker holds the creation time: true only when the root step read them all and they agree. Any failure
 * of the step is false, and so is a creation time the engine did not give.
 */
export async function commandsRan(
  rootChannel: HostChannel,
  facts: MarkerFacts,
  cancellation: AbortSignal,
): Promise<boolean> {
  if (facts.names.length === 0) {
    return true;
  }
  if (facts.created === '') {
    return false;
  }
  const lines: string[] = [];
  const outcome = await rootChannel.runScript(
    {
      script: MARKERS_SCRIPT,
      interpreter: 'posixShell',
      environment: {
        MARKER_USER: facts.user,
        MARKER_ENV_HOME: facts.environmentHome ?? '',
        MARKER_CREATED: facts.created,
        MARKER_NAMES: facts.names.join(' '),
      },
      input: {kind: 'text', text: ''},
      cancellation,
    },
    line => {
      lines.push(line);
    },
  );
  return (
    outcome.kind !== 'failed' &&
    outcome.status === 0 &&
    lines.includes(RAN_LINE)
  );
}

/** The arguments of the `docker inspect` that gives the container's creation time and environment. */
export function markerInspectArguments(containerId: string): string[] {
  return [
    'inspect',
    '--type',
    'container',
    '--format',
    '{{json .Created}}{{"\\n"}}{{json .Config.Env}}',
    containerId,
  ];
}

/** The creation time and the `HOME` of the container's environment from that inspect, or nothing when it says neither. */
export function parseMarkerInspect(
  stdout: string,
): Pick<MarkerFacts, 'created' | 'environmentHome'> | undefined {
  const [createdLine = '', environmentLine = ''] = stdout.split('\n');
  try {
    const created: unknown = JSON.parse(createdLine);
    const environment: unknown = JSON.parse(environmentLine);
    if (typeof created !== 'string' || !Array.isArray(environment)) {
      return undefined;
    }
    const home = environment.find(
      (entry): entry is string =>
        typeof entry === 'string' && entry.startsWith('HOME='),
    );
    return {
      created,
      environmentHome:
        home === undefined ? undefined : home.slice('HOME='.length),
    };
  } catch {
    return undefined;
  }
}
