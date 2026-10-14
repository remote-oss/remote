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
