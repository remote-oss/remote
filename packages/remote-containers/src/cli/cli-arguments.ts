/**
 * @fileoverview The arguments of the dev container CLI's three subcommands, as lists of elements for a spawn with no
 * shell: a path with spaces or quotes reaches the CLI unchanged. The order of a list is fixed.
 */

/** What the CLI is told about the dev container it works on. */
export interface CliTarget {
  /** The host folder. */
  workspaceFolder: string;
  /** The chosen devcontainer.json, absolute. */
  configFile: string;
  dockerPath: string;
  /** `name=value` labels that find the container again. */
  idLabels: readonly string[];
  /** An override file the pre-pass wrote, when it changed anything. */
  overrideConfigFile?: string;
  mountWorkspaceGitRoot: boolean;
  /** `--mount` values for `up`. */
  mounts: readonly string[];
  logLevel: 'info' | 'debug' | 'trace';
}

/** What `up` may be asked to do beyond the target. */
export interface UpOptions {
  removeExistingContainer: boolean;
  buildNoCache: boolean;
}

/** The arguments every subcommand starts with, up to the log format. */
function commonArguments(subcommand: string, target: CliTarget): string[] {
  return [
    subcommand,
    '--workspace-folder',
    target.workspaceFolder,
    '--config',
    target.configFile,
    ...(target.overrideConfigFile === undefined
      ? []
      : ['--override-config', target.overrideConfigFile]),
    ...target.idLabels.flatMap(label => ['--id-label', label]),
    '--docker-path',
    target.dockerPath,
    ...(target.mountWorkspaceGitRoot
      ? []
      : ['--mount-workspace-git-root=false']),
    '--log-level',
    target.logLevel,
    '--log-format',
    'json',
  ];
}

/** Creates the container or finds it, runs the commands up to the one `waitFor` names, and gives its id. */
export function upArguments(target: CliTarget, options: UpOptions): string[] {
  return [
    ...commonArguments('up', target),
    ...target.mounts.flatMap(mount => ['--mount', mount]),
    '--skip-non-blocking-commands',
    ...(options.removeExistingContainer ? ['--remove-existing-container'] : []),
    ...(options.buildNoCache ? ['--build-no-cache'] : []),
  ];
}

/** Runs the commands `up` left for the background stage in the container. */
export function runUserCommandsArguments(
  target: CliTarget,
  containerId: string,
): string[] {
  return [
    ...commonArguments('run-user-commands', target),
    '--container-id',
    containerId,
  ];
}

/**
 * Reads the configuration. With a container id it is merged with the container's metadata; without one the merge would
 * read the image's metadata and pull the image, which the read before a reload must not do.
 */
export function readConfigurationArguments(
  target: CliTarget,
  containerId?: string,
): string[] {
  return [
    ...commonArguments('read-configuration', target),
    ...(containerId === undefined
      ? []
      : ['--container-id', containerId, '--include-merged-configuration']),
  ];
}
