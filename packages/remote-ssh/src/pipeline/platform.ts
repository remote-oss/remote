/**
 * @fileoverview The platform of a host as the settings and the user say it, and the rules that follow from it: which
 * platform decides the scripts before anything is connected, whether a host's remote command is in effect, and what
 * is written back to `remote.SSH.remotePlatform` once a connect has worked. Nothing here opens a connection.
 */

/** The platforms the setting names. */
export type RemotePlatform = 'linux' | 'macOS' | 'windows';

const PLATFORMS: readonly string[] = ['linux', 'macOS', 'windows'];

/** The settings the decision reads, as the editor reports them. */
export interface PlatformSettings {
  /** `remote.SSH.useLocalServer`: the shared connection is on. */
  useLocalServer: boolean;
  /** `remote.SSH.remotePlatform`, a map from a host name or a pattern to a platform. */
  remotePlatform: unknown;
  /** `remote.SSH.windowsRemotes`, a list of exact host names. */
  windowsRemotes: unknown;
}

/** How the platform is found out. */
export type PlatformDecision =
  {kind: 'decided'; platform: RemotePlatform} | {kind: 'probe'} | {kind: 'ask'};

function isPlatform(value: unknown): value is RemotePlatform {
  return typeof value === 'string' && PLATFORMS.includes(value);
}

/** Whether a key matches the host: `*` stands for any run of characters, every other character is itself. */
function keyMatches(entryKey: string, host: string): boolean {
  const pattern = entryKey
    .split('*')
    .map(piece => piece.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join('.*');
  return new RegExp(`^${pattern}$`, 'u').test(host);
}

/**
 * The platform an entry of `remote.SSH.remotePlatform` gives the host. An exact key wins over every pattern, and
 * among patterns the first that matches wins; an entry whose value is not one of the three platforms counts as none.
 */
export function platformEntry(
  remotePlatform: unknown,
  host: string,
): RemotePlatform | undefined {
  if (
    typeof remotePlatform !== 'object' ||
    remotePlatform === null ||
    Array.isArray(remotePlatform)
  ) {
    return undefined;
  }
  const entries = Object.entries(remotePlatform).filter(
    (entry): entry is [string, RemotePlatform] => isPlatform(entry[1]),
  );
  const exact = entries.find(([name]) => name === host);
  return (exact ?? entries.find(([name]) => keyMatches(name, host)))?.[1];
}

/** Whether the host is listed by name in `remote.SSH.windowsRemotes`. */
function isListedWindows(windowsRemotes: unknown, host: string): boolean {
  return Array.isArray(windowsRemotes) && windowsRemotes.includes(host);
}

/**
 * How the platform of `host` is found out. A host listed as Windows, or matched to `windows`, is Windows in both
 * modes. A match to `linux` or `macOS` decides only when the shared connection is off; with it on, the probe finds
 * out. Without a match the probe finds out, or, with the shared connection off, the user is asked.
 */
export function decidePlatform(
  settings: PlatformSettings,
  host: string,
): PlatformDecision {
  if (isListedWindows(settings.windowsRemotes, host)) {
    return {kind: 'decided', platform: 'windows'};
  }
  const entry = platformEntry(settings.remotePlatform, host);
  if (
    entry === 'windows' ||
    (entry !== undefined && !settings.useLocalServer)
  ) {
    return {kind: 'decided', platform: entry};
  }
  return settings.useLocalServer ? {kind: 'probe'} : {kind: 'ask'};
}

/**
 * Whether the host's remote command runs: only when `remote.SSH.enableRemoteCommand` and the shared connection are
 * on and no entry of `remote.SSH.remotePlatform` names a platform for the host.
 */
export function remoteCommandInEffect(
  enableRemoteCommand: boolean,
  settings: PlatformSettings,
  host: string,
): boolean {
  return (
    enableRemoteCommand &&
    settings.useLocalServer &&
    platformEntry(settings.remotePlatform, host) === undefined
  );
}

/** What to write to `remote.SSH.remotePlatform` after a connect worked: nothing, or the exact key with the platform. */
export type PlatformWrite =
  {kind: 'none'} | {kind: 'set'; platform: RemotePlatform};

/**
 * The write after a successful connect with the shared connection off: the exact key for the host is set to the
 * platform the host reported when it is missing or holds another value, and nothing is written when it holds the
 * reported one. A pattern is never changed, and the shared connection on never writes.
 */
export function platformWrite(
  settings: PlatformSettings,
  host: string,
  reported: RemotePlatform,
): PlatformWrite {
  if (settings.useLocalServer) {
    return {kind: 'none'};
  }
  const entries = settings.remotePlatform;
  const held =
    typeof entries === 'object' && entries !== null && !Array.isArray(entries)
      ? (entries as Record<string, unknown>)[host]
      : undefined;
  return held === reported ? {kind: 'none'} : {kind: 'set', platform: reported};
}
