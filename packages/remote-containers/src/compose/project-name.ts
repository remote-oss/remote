/**
 * @fileoverview The Compose project name of a configuration: computed by the
 * extension before the dev container CLI runs, in a fixed order, and handed to the CLI and to Compose as one name.
 */

/** A name Compose accepts: lower-case letters, digits, `-` and `_`, starting with a letter or a digit. */
const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** What the name is read from, each as the configuration's folder holds it. */
export interface ProjectNameSources {
  /** `COMPOSE_PROJECT_NAME` in the editor's environment. */
  processName: string | undefined;
  /** `COMPOSE_PROJECT_NAME` in the workspace folder's `.env`. */
  workspaceEnvName: string | undefined;
  /** `COMPOSE_PROJECT_NAME` in the `.env` beside the compose file. */
  composeFolderEnvName: string | undefined;
  /** The top-level `name:` of the last compose file that declares one. */
  declaredName: string | undefined;
  /** The workspace folder's name. */
  workspaceBasename: string;
  /** The name of the folder of the first compose file. */
  composeFolderBasename: string;
  /** Whether that folder is the workspace folder's own `.devcontainer`. */
  composeFolderIsDevcontainer: boolean;
  /** Whether Compose accepts `-` and `_` in a name; false for a Compose older than 1.21. */
  dashAndUnderscore: boolean;
}

/** The name, or the source that gave a name Compose would not accept. */
export type ProjectName =
  | {kind: 'name'; name: string}
  | {
      kind: 'invalid';
      source: 'process' | 'composeFolderEnv' | 'declared' | 'folder';
      value: string;
    };

/** The name `value` becomes: lower case, the characters Compose does not allow dropped, and no leading `-` or `_`. */
export function normalizedProjectName(
  value: string,
  dashAndUnderscore: boolean,
): string {
  return value
    .toLowerCase()
    .replace(dashAndUnderscore ? /[^a-z0-9_-]/gu : /[^a-z0-9]/gu, '')
    .replace(/^[-_]+/u, '');
}

/** The project name of a configuration in a fixed order, or why none can be had. */
export function projectNameOf(sources: ProjectNameSources): ProjectName {
  const {dashAndUnderscore, processName, composeFolderEnvName} = sources;
  if (processName !== undefined && processName !== '') {
    return VALID_NAME.test(processName)
      ? {kind: 'name', name: processName}
      : {kind: 'invalid', source: 'process', value: processName};
  }
  const workspaceEnv = normalizedProjectName(
    sources.workspaceEnvName ?? '',
    dashAndUnderscore,
  );
  if (workspaceEnv !== '') {
    return {kind: 'name', name: workspaceEnv};
  }
  if (composeFolderEnvName !== undefined && composeFolderEnvName !== '') {
    return VALID_NAME.test(composeFolderEnvName)
      ? {kind: 'name', name: composeFolderEnvName}
      : {
          kind: 'invalid',
          source: 'composeFolderEnv',
          value: composeFolderEnvName,
        };
  }
  if (sources.declaredName !== undefined) {
    const declared = normalizedProjectName(
      sources.declaredName,
      dashAndUnderscore,
    );
    return declared === ''
      ? {kind: 'invalid', source: 'declared', value: sources.declaredName}
      : {kind: 'name', name: declared};
  }
  const folderValue = sources.composeFolderIsDevcontainer
    ? `${sources.workspaceBasename}_devcontainer`
    : sources.composeFolderBasename;
  const folder = normalizedProjectName(folderValue, dashAndUnderscore);
  return folder === ''
    ? {kind: 'invalid', source: 'folder', value: folderValue}
    : {kind: 'name', name: folder};
}
