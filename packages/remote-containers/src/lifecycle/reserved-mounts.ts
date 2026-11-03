/**
 * The mount targets that belong to the cache volume: `/vscode` and everything below it. The module reads the targets of
 * a devcontainer.json `mounts` entry and of a Compose service `volumes` entry, and finds the first reserved one.
 */

const RESERVED_ROOT = '/vscode';
const TARGET_KEYS = new Set(['target', 'dst', 'destination']);

/** Whether `target` is `/vscode` or lies below it; trailing slashes do not count. */
export function isReservedTarget(target: string): boolean {
  const trimmed = target.replace(/\/+$/, '');
  return trimmed === RESERVED_ROOT || trimmed.startsWith(`${RESERVED_ROOT}/`);
}

/** The target of a `mounts` entry: the string `key=value,...` form, or an object with a `target`. */
export function mountTargetOf(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    for (const part of entry.split(',')) {
      const separator = part.indexOf('=');
      if (
        separator >= 0 &&
        TARGET_KEYS.has(part.slice(0, separator).trim().toLowerCase())
      ) {
        return part.slice(separator + 1).trim();
      }
    }
    return undefined;
  }
  if (typeof entry === 'object' && entry !== null) {
    const {target} = entry as {target?: unknown};
    return typeof target === 'string' ? target : undefined;
  }
  return undefined;
}

/** The target of a service `volumes` entry: the short form `source:target[:mode]` (a lone path is the target), or the long form's `target`. */
export function serviceVolumeTargetOf(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    const parts = entry.split(':');
    return parts.length === 1 ? parts[0] : parts[1];
  }
  return mountTargetOf(entry);
}

/** One property and the targets it names. */
export interface MountSource {
  property: string;
  targets: ReadonlyArray<string | undefined>;
}

/** The first reserved target among `sources`, in order, with the property that names it. */
export function reservedMount(
  sources: readonly MountSource[],
): {property: string; target: string} | undefined {
  for (const {property, targets} of sources) {
    const target = targets.find(
      (candidate): candidate is string =>
        candidate !== undefined && isReservedTarget(candidate),
    );
    if (target !== undefined) {
      return {property, target};
    }
  }
  return undefined;
}
