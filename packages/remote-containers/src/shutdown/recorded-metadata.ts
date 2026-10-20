/**
 * @fileoverview The `devcontainer.metadata` label of a container, which records the configuration entries the
 * container was made from, `shutdownAction` among them: its `docker inspect` arguments, and the entries from what
 * they print.
 */

/** The label the dev container CLI records the merged configuration entries in. */
const METADATA_LABEL = 'devcontainer.metadata';

/** The arguments of the `docker inspect` that prints the container's metadata label alone. */
export function metadataArguments(containerId: string): string[] {
  return [
    'inspect',
    '--type',
    'container',
    '--format',
    `{{index .Config.Labels "${METADATA_LABEL}"}}`,
    containerId,
  ];
}

/** The entries the label holds, or undefined for a container with no label or one that is not a list. */
export function recordedMetadataOf(stdout: string): unknown[] | undefined {
  const text = stdout.trim();
  if (text === '') {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as unknown[]) : undefined;
  } catch {
    return undefined;
  }
}
