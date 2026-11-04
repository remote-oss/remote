/**
 * @fileoverview The dev container Explore a Volume opens a volume in: one fixed definition of ours, shared by every
 * volume and kept where the user can edit it, and the labels that make a second explore of the same volume find its
 * container again.
 */

/** The version of the definition; a new version has its own folder, so an edit of an older one stays. */
const EXPLORE_DEFINITION_VERSION = '1';

/** The variable that carries the volume's name to the CLI for one run; the definition reads it and names no volume. */
export const EXPLORE_VOLUME_VARIABLE = 'REMOTE_OSS_INSPECT_VOLUME';

/** The workspace mount of the definition: the volume at `/volume`. */
export const EXPLORE_WORKSPACE_MOUNT = `source=\${localEnv:${EXPLORE_VOLUME_VARIABLE}},target=/volume,type=volume`;

/** The text of the definition: Alpine, as root, with the volume at `/volume` and no Docker socket. */
export function exploreDefinitionText(): string {
  return `${JSON.stringify(
    {
      name: 'Inspect Volume',
      image: 'alpine:3.20',
      remoteUser: 'root',
      workspaceMount: EXPLORE_WORKSPACE_MOUNT,
      workspaceFolder: '/volume',
    },
    undefined,
    2,
  )}\n`;
}

/** A name Docker accepts for a volume: it starts with a letter or a digit and holds letters, digits, `_`, `.` and `-`. */
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

/** Whether `name` can be a volume name, which keeps a comma or a variable out of the mount the definition builds. */
export function exploredVolumeNameValid(name: string): boolean {
  return VOLUME_NAME.test(name);
}

/** The labels a container carries to be found again for the volume `volumeName` and the definition `configFile`. */
export function exploreIdLabels(
  volumeName: string,
  configFile: string,
): string[] {
  return [
    `vsch.local.volume=${volumeName}`,
    `devcontainer.config_file=${configFile}`,
  ];
}

/** What the host gives the definition: the folder it lives in, written once. */
export interface ExploreDefinitionPorts {
  /** The extension's own storage for the user: a folder only this user can write, not a shared temporary one. */
  storageFolder: string;
  join(...parts: string[]): string;
  exists(file: string): Promise<boolean>;
  /** Writes `text` to `file`, making its folders. */
  write(file: string, text: string): Promise<void>;
}

/** Where the definition is and what the CLI is given of it. */
export interface ExploreDefinition {
  /** The folder the CLI is given as its workspace folder. */
  folder: string;
  /** The definition's `devcontainer.json`. */
  configFile: string;
  /** The text the file was written with; the CLI reads the file itself. */
  text: string;
}

/**
 * The definition under `<temporary folder>/inspect-volume/<version>/`, written only when it is not there, so a user's
 * edit stays.
 */
export async function ensureExploreDefinition(
  ports: ExploreDefinitionPorts,
): Promise<ExploreDefinition> {
  const folder = ports.join(
    ports.storageFolder,
    'inspect-volume',
    EXPLORE_DEFINITION_VERSION,
  );
  const configFile = ports.join(folder, '.devcontainer', 'devcontainer.json');
  const text = exploreDefinitionText();
  if (!(await ports.exists(configFile))) {
    await ports.write(configFile, text);
  }
  return {folder, configFile, text};
}
