/**
 * @fileoverview The arguments of the dev container CLI's three subcommands, as lists of elements for a spawn with no
 * shell: a path with spaces or quotes reaches the CLI unchanged. The order of a list is fixed.
 */

/** The settings that decide which Features a build adds and whether it writes a lockfile. */
export interface FeatureSettings {
  /** The Features to always install, as the setting holds them; `features` of the configuration wins on the same id. */
  defaultFeatures: Readonly<Record<string, unknown>>;
  /** Whether `devcontainer-lock.json` is written. */
  lockfile: boolean;
}

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
  /** Whether the Git worktree's common dir is mounted (`dev.containers.experimentalMountGitWorktreeCommonDir`). */
  mountGitWorktreeCommonDir: boolean;
  features: FeatureSettings;
  /** `--mount` values for `up`. */
  mounts: readonly string[];
  logLevel: 'info' | 'debug' | 'trace';
  /** The size of the terminal the run's lifecycle commands show in, whole rows and columns of at least one. */
  terminalSize?: {rows: number; columns: number};
  /** The Compose program of the second route, which the CLI runs instead of the Docker CLI's plugin. */
  composePath?: string;
  /** Where the CLI keeps its data, among them the override files of a Compose project (`--user-data-folder`). */
  userDataFolder?: string;
  /** Variables added to the editor's environment for the CLI's process, such as `COMPOSE_PROJECT_NAME`. */
  environment?: Readonly<Record<string, string>>;
}

/** What `up` may be asked to do beyond the target. */
export interface UpOptions {
  removeExistingContainer: boolean;
  buildNoCache: boolean;
  /** The consistency of the workspace mount, as the setting has it; the CLI refuses a value it doesn't know. */
  workspaceMountConsistency: string;
}

/** The size of the terminal a run's lifecycle commands show in, as arguments; none when the size is not known. */
function terminalArguments(
  size: {rows: number; columns: number} | undefined,
): string[] {
  return size === undefined
    ? []
    : [
        '--terminal-rows',
        String(size.rows),
        '--terminal-columns',
        String(size.columns),
      ];
}

/** The arguments every subcommand starts with, up to the log format and the terminal size. */
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
    ...(target.composePath === undefined
      ? []
      : ['--docker-compose-path', target.composePath]),
    ...(target.userDataFolder === undefined
      ? []
      : ['--user-data-folder', target.userDataFolder]),
    ...(target.mountWorkspaceGitRoot
      ? []
      : ['--mount-workspace-git-root=false']),
    ...(target.mountGitWorktreeCommonDir
      ? ['--mount-git-worktree-common-dir']
      : []),
    '--log-level',
    target.logLevel,
    '--log-format',
    'json',
    ...terminalArguments(target.terminalSize),
  ];
}

/** `--additional-features` with the default Features as JSON, when the setting names any. */
function additionalFeatures(target: CliTarget): string[] {
  return Object.keys(target.features.defaultFeatures).length === 0
    ? []
    : [
        '--additional-features',
        JSON.stringify(target.features.defaultFeatures),
      ];
}

/** Creates the container or finds it, runs no lifecycle command, and gives its id; the commands come after the server's files. */
export function upArguments(target: CliTarget, options: UpOptions): string[] {
  return [
    ...commonArguments('up', target),
    ...target.mounts.flatMap(mount => ['--mount', mount]),
    ...additionalFeatures(target),
    ...(target.features.lockfile ? [] : ['--no-lockfile']),
    '--skip-post-create',
    '--workspace-mount-consistency',
    options.workspaceMountConsistency,
    ...(options.removeExistingContainer ? ['--remove-existing-container'] : []),
    ...(options.buildNoCache ? ['--build-no-cache'] : []),
  ];
}

/** The dotfiles a run clones into the container, from the three machine settings. */
interface DotfilesOptions {
  repository: string;
  installCommand?: string;
  targetPath?: string;
}

/** Which of the lifecycle commands a `run-user-commands` runs, and what it hands them. */
export interface RunUserCommandsOptions {
  /** Runs the commands up to the one `waitFor` names, and no further. */
  skipNonBlocking?: boolean;
  /** Stops after `postCreateCommand` and the dotfiles, for the personalization that follows. */
  stopForPersonalization?: boolean;
  /** Variables the commands see, after the probed environment and before the configuration's `remoteEnv`. */
  remoteEnvironment?: Readonly<Record<string, string>>;
  dotfiles?: DotfilesOptions;
}

/** The dotfiles options, when a repository is set. */
function dotfilesArguments(dotfiles: DotfilesOptions | undefined): string[] {
  if (dotfiles === undefined || dotfiles.repository === '') {
    return [];
  }
  return [
    '--dotfiles-repository',
    dotfiles.repository,
    ...(dotfiles.installCommand === undefined
      ? []
      : ['--dotfiles-install-command', dotfiles.installCommand]),
    ...(dotfiles.targetPath === undefined
      ? []
      : ['--dotfiles-target-path', dotfiles.targetPath]),
  ];
}

/** The stages of a `run-user-commands`, the variables it hands the commands and the dotfiles. */
function stageArguments(options: RunUserCommandsOptions): string[] {
  return [
    ...(options.skipNonBlocking === true
      ? ['--skip-non-blocking-commands']
      : []),
    ...(options.stopForPersonalization === true
      ? ['--stop-for-personalization']
      : []),
    ...Object.entries(options.remoteEnvironment ?? {}).flatMap(
      ([name, value]) => ['--remote-env', `${name}=${value}`],
    ),
    ...dotfilesArguments(options.dotfiles),
  ];
}

/** Runs lifecycle commands in the container: the blocking ones, or the rest in the background, as `options` say. */
export function runUserCommandsArguments(
  target: CliTarget,
  containerId: string,
  options: RunUserCommandsOptions = {},
): string[] {
  return [
    ...commonArguments('run-user-commands', target),
    '--container-id',
    containerId,
    ...stageArguments(options),
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
    ...additionalFeatures(target),
    ...(containerId === undefined
      ? []
      : ['--container-id', containerId, '--include-merged-configuration']),
  ];
}

/**
 * Asks which Features of the configuration are behind. The CLI reads the registries and needs no container engine, so
 * there is no Docker program in the arguments; the result is one JSON line on stdout.
 */
export function outdatedArguments(target: CliTarget): string[] {
  return [
    'outdated',
    '--workspace-folder',
    target.workspaceFolder,
    '--config',
    target.configFile,
    '--output-format',
    'json',
    '--log-level',
    target.logLevel,
    '--log-format',
    'json',
  ];
}

/** What `templates apply` is asked to do: the template, its options, the Features to add and the paths to leave out. */
export interface TemplateRequest {
  /** The scratch folder the template is applied into. */
  workspaceFolder: string;
  templateId: string;
  templateArgs: Readonly<Record<string, string | boolean>>;
  features: ReadonlyArray<{
    id: string;
    options: Readonly<Record<string, unknown>>;
  }>;
  omitPaths: readonly string[];
}

/**
 * The options as the CLI reads them: every value text. The CLI writes an option into the files as `options[name] || ''`,
 * so a boolean `false` would come out empty; `'false'` is text and survives.
 */
function optionTexts(
  templateArgs: TemplateRequest['templateArgs'],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(templateArgs).map(([name, value]) => [name, String(value)]),
  );
}

/** Applies a template into the request's folder; the options, Features and omitted paths go as JSON texts. */
export function applyTemplateArguments(request: TemplateRequest): string[] {
  return [
    'templates',
    'apply',
    '-w',
    request.workspaceFolder,
    '-t',
    request.templateId,
    '-a',
    JSON.stringify(optionTexts(request.templateArgs)),
    '-f',
    JSON.stringify(request.features),
    '--omit-paths',
    JSON.stringify(request.omitPaths),
    '--log-level',
    'info',
  ];
}

/** Reads a template's metadata from its registry. */
export function templateMetadataArguments(templateId: string): string[] {
  return ['templates', 'metadata', templateId, '--log-level', 'info'];
}

/** What the CLI is told about an attached container: no folder and no id labels, only the container and its attach file. */
export interface AttachedCliTarget {
  containerId: string;
  /** The attach configuration file that applies, absolute; none when there is none. */
  configFile?: string;
  dockerPath: string;
  logLevel: 'info' | 'debug' | 'trace';
  /** The size of the terminal the run's lifecycle commands show in, whole rows and columns of at least one. */
  terminalSize?: {rows: number; columns: number};
  /** Where the CLI keeps its data (`--user-data-folder`). */
  userDataFolder?: string;
  /** Variables added to the editor's environment for the CLI's process, such as the engine coordinate. */
  environment?: Readonly<Record<string, string>>;
}

/** The arguments an attached container's runs share, after the subcommand and the container. */
function attachedCommonArguments(target: AttachedCliTarget): string[] {
  return [
    '--container-id',
    target.containerId,
    ...(target.configFile === undefined ? [] : ['--config', target.configFile]),
    '--docker-path',
    target.dockerPath,
    ...(target.userDataFolder === undefined
      ? []
      : ['--user-data-folder', target.userDataFolder]),
    '--log-level',
    target.logLevel,
    '--log-format',
    'json',
    ...terminalArguments(target.terminalSize),
  ];
}

/**
 * Sets up a running container the CLI did not create: it merges the container's metadata with the attach file, patches
 * `/etc/environment` and `/etc/profile`, and gives the merged configuration.
 */
export function setUpArguments(target: AttachedCliTarget): string[] {
  return [
    'set-up',
    ...attachedCommonArguments(target),
    '--skip-non-blocking-commands',
    '--include-merged-configuration',
  ];
}

/**
 * Runs lifecycle commands in an attached container: no folder is named, the container is found by its id, and the
 * run's stages are chosen as for a dev container's.
 */
export function attachedUserCommandsArguments(
  target: AttachedCliTarget,
  options: RunUserCommandsOptions = {},
): string[] {
  return [
    'run-user-commands',
    ...attachedCommonArguments(target),
    ...stageArguments(options),
  ];
}
