/**
 * @fileoverview What `devcontainer open` will do the folder, the configuration it reads as JSONC, the
 * path the window opens inside the container, and the address of the window; or the error that names what is wrong, in
 * which case nothing is launched.
 */

import {parse, type ParseError} from 'jsonc-parser';
import {resolvedReferences} from '../cli/override-pre-pass.ts';
import {isComposeConfiguration} from '../config/configuration-text.ts';
import type {OpenArguments} from './open-arguments.ts';
import {openPathOf, type PathFlavor} from './open-path.ts';

/** The configuration files of a folder, in the order the extension looks for them. */
const DEFAULT_CONFIGURATIONS = [
  ['.devcontainer', 'devcontainer.json'],
  ['.devcontainer.json'],
];

/** What the plan needs of the machine it runs on. */
export interface OpenPorts {
  /** The physical current folder. */
  current: string;
  flavor: PathFlavor;
  /** The environment the references of `workspaceFolder` read. */
  environment: Readonly<Record<string, string | undefined>>;
  /** What a path is: a folder, a file, or nothing. */
  kindOf(target: string): Promise<'folder' | 'file' | 'missing'>;
  /** The text of a file; none when it can't be read. */
  readText(file: string): Promise<string | undefined>;
}

/** What the command launches. */
export interface OpenPlan {
  kind: 'launch';
  /** The folder the container belongs to. */
  folder: string;
  /** The configuration file named by `--config`, in the form the address carries it. */
  configFile: string | undefined;
  /** The folder the window opens inside the container. */
  workspacePath: string;
}

/** Why nothing is launched. */
export interface OpenRefusal {
  kind: 'refused';
  message: string;
}

/** A path inside the container: the segments of `value` that aren't empty, joined by `/` behind a first one. */
function containerPathOf(value: string): string {
  return `/${value
    .split('/')
    .filter(segment => segment !== '')
    .join('/')}`;
}

/** The path the window opens in the container for the configuration `configuration` of `folder`. */
function workspacePathOf(
  configuration: Record<string, unknown>,
  folder: string,
  ports: OpenPorts,
): string {
  const declared = configuration.workspaceFolder;
  if (typeof declared === 'string') {
    const basename = ports.flavor.basename(folder);
    const known = resolvedReferences(
      declared
        .replaceAll('${localWorkspaceFolderBasename}', basename)
        .replaceAll('${localWorkspaceFolder}', folder),
      ports.environment,
    );
    return containerPathOf(known.replace(/\$\{[^}]*\}/g, ''));
  }
  return isComposeConfiguration(configuration)
    ? '/'
    : containerPathOf(`workspaces/${ports.flavor.basename(folder)}`);
}

/** The first default configuration the folder holds, none when it holds none. */
async function defaultConfigurationOf(
  folder: string,
  ports: OpenPorts,
): Promise<string | undefined> {
  for (const names of DEFAULT_CONFIGURATIONS) {
    const file = ports.flavor.join(folder, ...names);
    if ((await ports.kindOf(file)) === 'file') {
      return file;
    }
  }
  return undefined;
}

/** The configuration object `text` holds, or why it holds none. */
function configurationOf(
  text: string,
  file: string,
): Record<string, unknown> | string {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, {allowTrailingComma: true});
  if (text.trim() !== '' && errors.length > 0) {
    return `${file} is not valid JSON with comments`;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : `${file} holds no configuration`;
}

/** The plan for `open` with `parsed`, or the refusal that names what is wrong. */
export async function openPlanOf(
  parsed: Extract<OpenArguments, {kind: 'open'}>,
  ports: OpenPorts,
): Promise<OpenPlan | OpenRefusal> {
  const typed = openPathOf(parsed.path, ports.current, ports.flavor);
  const kind = await ports.kindOf(typed);
  if (kind === 'missing') {
    return {kind: 'refused', message: `${typed} does not exist`};
  }
  if (kind === 'file' && !typed.endsWith('.code-workspace')) {
    return {
      kind: 'refused',
      message: `${typed} is neither a folder nor a .code-workspace file`,
    };
  }
  // A workspace file means the folder it is in, whose container the window gets.
  const folder = kind === 'file' ? ports.flavor.dirname(typed) : typed;
  const configFile =
    parsed.config === undefined
      ? undefined
      : openPathOf(parsed.config, ports.current, ports.flavor);
  const file = configFile ?? (await defaultConfigurationOf(folder, ports));
  if (file === undefined) {
    return {
      kind: 'refused',
      message: `${folder} has no dev container configuration file`,
    };
  }
  const text = await ports.readText(file);
  if (text === undefined) {
    return {kind: 'refused', message: `${file} cannot be read`};
  }
  const configuration = configurationOf(text, file);
  if (typeof configuration === 'string') {
    return {kind: 'refused', message: configuration};
  }
  return {
    kind: 'launch',
    folder,
    configFile,
    workspacePath: workspacePathOf(configuration, folder, ports),
  };
}
