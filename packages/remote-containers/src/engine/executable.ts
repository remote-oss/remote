import path from 'node:path';

/** The program a check spawns, or the news that the written value names none. */
export type Executable =
  | {kind: 'spawn'; file: string; written: string}
  | {kind: 'notFound'; written: string};

const DEFAULT_PROGRAM = 'docker';

/** A value the shell would expand, which is not expanded here: it is spawned as it is, and does not exist. */
function isShellForm(value: string): boolean {
  return /^[~$%]/.test(value);
}

/** What a window says of its folder: the first one, and whether the window is trusted. */
export interface WindowFolder {
  folder: string | undefined;
  trusted: boolean;
}

/**
 * The base a relative `dev.containers.dockerPath` is resolved against: the window's first folder only once the window
 * is trusted, none before, since a relative value is a file of the folder and nothing of an untrusted folder runs.
 */
export function engineBaseOf(window: WindowFolder): string | undefined {
  return window.trusted ? window.folder : undefined;
}

/**
 * The program that `dev.containers.dockerPath` names. The value is literal: nothing is expanded or split, and no
 * shell reads it. An absolute or bare name is spawned as written (a bare name is searched for on the PATH by the
 * spawn); a relative one is resolved against `base`, and has no program when there is none.
 */
export function executableOf(
  value: unknown,
  base: string | undefined,
): Executable {
  const written =
    typeof value === 'string' && value !== '' ? value : DEFAULT_PROGRAM;
  const relative =
    written.includes('/') && !written.startsWith('/') && !isShellForm(written);
  if (!relative) {
    return {kind: 'spawn', file: written, written};
  }
  return base === undefined
    ? {kind: 'notFound', written}
    : {kind: 'spawn', file: path.resolve(base, written), written};
}
