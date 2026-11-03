/**
 * @fileoverview The bootstrap container a clone runs in: our own image on Alpine, whose definition is the package's
 * `resources/volume-bootstrap/Dockerfile`, the container that mounts the volume and the engine's socket, and the check
 * that the tools it needs are on its `PATH`. Every step is an engine call read by its exit status.
 */

/** The tag our built-in bootstrap image is built under. */
export const BOOTSTRAP_TAG = 'vsc-volume-bootstrap:latest';

/** Where the image keeps the dev container CLI the extension bundles, and the preload the CLI runs with. */
export const BOOTSTRAP_CLI = {
  entry: '/usr/local/share/remote-oss/devcontainers-cli/devcontainer.js',
  preload: '/usr/local/share/remote-oss/cli-preload.js',
} as const;

/** The names in the build context of the CLI's folder and the preload, which the image's definition copies in. */
export const CONTEXT_NAMES = {
  cliFolder: 'devcontainers-cli',
  preload: 'cli-preload.js',
} as const;

/** The tools the check looks for, in its fixed order. */
export const BOOTSTRAP_TOOLS = [
  'docker',
  'git',
  'node',
  'ssh',
  'git-lfs',
] as const;

/** A tool the check looks for. */
export type BootstrapTool = (typeof BOOTSTRAP_TOOLS)[number];

/** The bootstrap settings, read at every start. */
export interface BootstrapSettings {
  /** `dev.containers.bootstrapImage`; empty for the built-in image. */
  image: string;
  /** `dev.containers.bootstrapImagePull`. */
  pull: boolean;
  /** `dev.containers.dockerSocketPath`. */
  socketPath: string;
}

/** The socket the container binds when the setting gives none. */
export const DEFAULT_SOCKET_PATH = '/var/run/docker.sock';

/** The settings as they are read: a value of the wrong type, or an empty one, counts as unset. */
export function bootstrapSettingsOf(read: {
  image: unknown;
  pull: unknown;
  socketPath: unknown;
}): BootstrapSettings {
  const image = typeof read.image === 'string' ? read.image.trim() : '';
  const socketPath =
    typeof read.socketPath === 'string' ? read.socketPath.trim() : '';
  return {
    image,
    pull: read.pull === true,
    socketPath: socketPath === '' ? DEFAULT_SOCKET_PATH : socketPath,
  };
}

/** The engine calls that make the image ready: build ours, or pull a custom one when its setting asks. */
export function imageArgumentsOf(
  settings: BootstrapSettings,
  contextFolder: string,
): {image: string; calls: string[][]} {
  if (settings.image === '') {
    return {
      image: BOOTSTRAP_TAG,
      calls: [['build', '--tag', BOOTSTRAP_TAG, '--', contextFolder]],
    };
  }
  return {
    image: settings.image,
    calls: settings.pull ? [['pull', '--', settings.image]] : [],
  };
}

/** The engine's arguments that start the bootstrap container: as root, the volume at `/workspaces`, the socket bound. */
export function bootstrapRunArguments(
  image: string,
  volume: string,
  socketPath: string,
): string[] {
  return [
    'run',
    '--detach',
    '--user',
    'root',
    '--mount',
    `type=volume,src=${volume},dst=/workspaces`,
    '--mount',
    `type=bind,src=${socketPath},dst=/var/run/docker.sock`,
    '--entrypoint',
    '/bin/sh',
    image,
    '-c',
    'trap "exit 0" TERM; while sleep 3600; do :; done',
  ];
}

/** The engine's arguments that look for `tool` on the container's `PATH`; its exit status answers. */
export function toolCheckArguments(
  container: string,
  tool: BootstrapTool,
): string[] {
  return [
    'exec',
    container,
    '/bin/sh',
    '-c',
    'command -v -- "$0" >/dev/null',
    tool,
  ];
}

/** How the tool check ended: every required tool found, or the string of the dialog for the first one missing. */
export type ToolCheckOutcome =
  {kind: 'ok'} | {kind: 'missing'; reason: 'S344' | 'S345'};

/** The outcome of the tools found: the Docker CLI's absence wins over Git's, and the other three are optional. */
export function toolCheckOutcomeOf(
  found: ReadonlySet<BootstrapTool>,
): ToolCheckOutcome {
  if (!found.has('docker')) {
    return {kind: 'missing', reason: 'S344'};
  }
  return found.has('git') ? {kind: 'ok'} : {kind: 'missing', reason: 'S345'};
}

/** The one log line of the check: each tool, in order, with whether it was found. */
export function toolCheckLineOf(found: ReadonlySet<BootstrapTool>): string {
  return `the bootstrap container's tools: ${BOOTSTRAP_TOOLS.map(tool => `${tool} ${found.has(tool) ? 'found' : 'missing'}`).join(', ')}`;
}

/** The engine's arguments that remove the bootstrap container, running or not. */
export function bootstrapRemoveArguments(container: string): string[] {
  return ['rm', '--force', '--', container];
}
