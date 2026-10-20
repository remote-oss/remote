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
  /** Whether the Git worktree's common dir is mounted (`dev.containers.experimentalMountGitWorktreeCommonDir`). */
  mountGitWorktreeCommonDir: boolean;
  /** `--mount` values for `up`. */
  mounts: readonly string[];
  logLevel: 'info' | 'debug' | 'trace';
  /** The size of the terminal the run's lifecycle commands show in, whole rows and columns of at least one. */
  terminalSize?: {rows: number; columns: number};
}

/** What `up` may be asked to do beyond the target. */
export interface UpOptions {
  removeExistingContainer: boolean;
  buildNoCache: boolean;
  /** The consistency of the workspace mount, as the setting has it; the CLI refuses a value it doesn't know. */
  workspaceMountConsistency: string;
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
    ...(target.terminalSize === undefined
      ? []
      : [
          '--terminal-rows',
          String(target.terminalSize.rows),
          '--terminal-columns',
          String(target.terminalSize.columns),
        ]),
  ];
}

/** Creates the container or finds it, runs the commands up to the one `waitFor` names, and gives its id. */
export function upArguments(target: CliTarget, options: UpOptions): string[] {
  return [
    ...commonArguments('up', target),
    ...target.mounts.flatMap(mount => ['--mount', mount]),
    '--skip-non-blocking-commands',
    '--workspace-mount-consistency',
    options.workspaceMountConsistency,
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
