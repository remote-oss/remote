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

/** A Windows drive letter and its separator at the start of a source: its colon belongs to the source. */
const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/;

/**
 * The target of a service `volumes` entry, or of the value of a `-v` option: the short form `source:target[:mode]`, read
 * as Docker reads it (a lone path is the target, and a drive letter's colon belongs to the source), or the long form's
 * `target`.
 */
export function serviceVolumeTargetOf(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    const parts = entry.slice(DRIVE_PREFIX.test(entry) ? 2 : 0).split(':');
    return parts.length === 1 ? entry : parts[1];
  }
  return mountTargetOf(entry);
}

/** The options of `runArgs` that mount a volume or a bind by `src:dst[:mode]`, and the one that mounts by `key=value,...`. */
const VOLUME_OPTIONS = new Set(['-v', '--volume']);
const MOUNT_OPTIONS = new Set(['--mount']);

/** The short volume option, whose value may follow it in the same element (`-vNAME:/target`). */
const SHORT_VOLUME = '-v';

/**
 * The targets the `-v`, `--volume` and `--mount` options of `runArgs` name, in order: an option takes its value from the
 * next element, after an `=` in a long option, or from the rest of its own element for `-v`; an option with no string value, and any other element, names none.
 */
export function runArgsTargets(runArgs: readonly unknown[]): string[] {
  const targets: string[] = [];
  for (let index = 0; index < runArgs.length; index += 1) {
    const option = runArgs[index];
    if (typeof option !== 'string') {
      continue;
    }
    const separator = option.indexOf('=');
    const inline = option.startsWith('--') && separator > 0;
    const attached = option.length > 2 && option.startsWith(SHORT_VOLUME);
    const name = inline ? option.slice(0, separator) : option;
    if (!attached && !VOLUME_OPTIONS.has(name) && !MOUNT_OPTIONS.has(name)) {
      continue;
    }
    const value = inline
      ? option.slice(separator + 1)
      : attached
        ? option.slice(2)
        : runArgs[index + 1];
    if (!inline && !attached) {
      index += 1;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const target =
      attached || VOLUME_OPTIONS.has(name)
        ? serviceVolumeTargetOf(value)
        : mountTargetOf(value);
    if (target !== undefined) {
      targets.push(target);
    }
  }
  return targets;
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
