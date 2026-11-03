/**
 * @fileoverview Where the Compose project name is read from: the editor's environment and the `.env`
 * files of the workspace folder and of the compose file's folder, read as the dev container CLI reads them.
 */

import path from 'node:path';
import type {ProjectNameSources} from './project-name.ts';

/** What the sources need from outside. */
export interface ProjectSourcePorts {
  /** The text of a file of the client; it rejects when the file cannot be read. */
  readText(file: string): Promise<string>;
  /** The editor's environment. */
  environment: Readonly<Record<string, string | undefined>>;
}

/** What names the project besides the files. */
export interface ProjectSourceInput {
  workspaceFolder: string;
  /** The configuration's compose files, absolute and in order. */
  files: readonly string[];
  declaredName: string | undefined;
  /** Whether Compose accepts `-` and `_` in a name. */
  dashAndUnderscore: boolean;
}

/** `COMPOSE_PROJECT_NAME` in the text of a `.env`, as the CLI reads it: the first line that sets it, trimmed. */
export function envProjectNameOf(text: string): string | undefined {
  const value = /^COMPOSE_PROJECT_NAME=(.+)$/mu.exec(text)?.[1]?.trim();
  return value === '' ? undefined : value;
}

/** The project name set in the `.env` of `folder`; none when there is no such file or it sets none. */
async function envNameIn(
  ports: ProjectSourcePorts,
  folder: string,
): Promise<string | undefined> {
  try {
    return envProjectNameOf(await ports.readText(path.join(folder, '.env')));
  } catch {
    return undefined;
  }
}

/** The sources of the project name of a configuration's compose files. */
export async function projectSourcesOf(
  ports: ProjectSourcePorts,
  input: ProjectSourceInput,
): Promise<ProjectNameSources> {
  const {workspaceFolder} = input;
  const composeFolder =
    input.files[0] === undefined ? undefined : path.dirname(input.files[0]);
  return {
    processName: ports.environment.COMPOSE_PROJECT_NAME,
    workspaceEnvName: await envNameIn(ports, workspaceFolder),
    composeFolderEnvName:
      composeFolder === undefined || composeFolder === workspaceFolder
        ? undefined
        : await envNameIn(ports, composeFolder),
    declaredName: input.declaredName,
    workspaceBasename: path.basename(workspaceFolder),
    composeFolderBasename: path.basename(composeFolder ?? workspaceFolder),
    composeFolderIsDevcontainer:
      composeFolder === path.join(workspaceFolder, '.devcontainer'),
    dashAndUnderscore: input.dashAndUnderscore,
  };
}
