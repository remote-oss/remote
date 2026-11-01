/**
 * @fileoverview The host variants of the acceptance tests: the login shells and the download tools a host may have,
 * and the image the host starts from; and the one this process runs, named by the harness variable of the run.
 */

/** The login shells of `HOST_SHELL`, by the path `usermod -s` takes, in the order the variant run goes through them. */
export const SHELL_VARIANTS = [
  '/bin/sh',
  '/bin/bash',
  '/bin/zsh',
  '/usr/bin/dash',
  '/usr/bin/fish',
  '/bin/tcsh',
  '/bin/csh',
  '/bin/mksh',
] as const;

/** One login shell of a host. */
export type ShellVariant = (typeof SHELL_VARIANTS)[number];

/** Whether `value` names a login shell of a host. */
function isShellVariant(value: string): value is ShellVariant {
  return (SHELL_VARIANTS as readonly string[]).includes(value);
}

/**
 * The login shell this process runs the rows of, from `HARNESS_HOST_SHELL`; undefined when it is unset, which is the
 * host's own. A name that is none of the shells throws.
 */
export function shellVariantOf(
  environment: Readonly<Record<string, string | undefined>>,
): ShellVariant | undefined {
  const named = environment.HARNESS_HOST_SHELL;
  if (named === undefined || named === '') {
    return undefined;
  }
  if (!isShellVariant(named)) {
    throw new Error(`HARNESS_HOST_SHELL names no login shell: ${named}`);
  }
  return named;
}

/** The login shells whose rows this process runs: the one named, or all. */
export function shellVariantsToRun(
  environment: Readonly<Record<string, string | undefined>>,
): readonly ShellVariant[] {
  const named = shellVariantOf(environment);
  return named === undefined ? SHELL_VARIANTS : [named];
}

/** The download tools of `HOST_FETCH`, in the order the variant run goes through them. */
export const FETCH_VARIANTS = [
  'busybox-wget',
  'gnu-wget',
  'curl',
  'none',
] as const;

/** One download tool of a host. */
export type FetchVariant = (typeof FETCH_VARIANTS)[number];

/** Whether `value` names a download tool of a host. */
function isFetchVariant(value: string): value is FetchVariant {
  return (FETCH_VARIANTS as readonly string[]).includes(value);
}

/**
 * The download tool this process runs the rows of, from `HARNESS_HOST_FETCH`; undefined when it is unset, which is
 * the whole list. A name that is none of the tools throws.
 */
export function fetchVariantOf(
  environment: Readonly<Record<string, string | undefined>>,
): FetchVariant | undefined {
  const named = environment.HARNESS_HOST_FETCH;
  if (named === undefined || named === '') {
    return undefined;
  }
  if (!isFetchVariant(named)) {
    throw new Error(`HARNESS_HOST_FETCH names no download tool: ${named}`);
  }
  return named;
}

/** The download tools whose rows this process runs: the one named, or all. */
export function fetchVariantsToRun(
  environment: Readonly<Record<string, string | undefined>>,
): readonly FetchVariant[] {
  const named = fetchVariantOf(environment);
  return named === undefined ? FETCH_VARIANTS : [named];
}

/**
 * The bases of `HARNESS_HOST_BASE`: the image the run starts its SSH host from. Alpine's is the default; Ubuntu 26.04's
 * has uutils, Ubuntu 18.04's a glibc (2.27) below the server's, and Debian 12's a glibc (2.36) above it.
 */
export const HOST_BASE_VARIANTS = [
  'alpine',
  'ubuntu-26.04',
  'ubuntu-18.04',
  'debian-12',
] as const;

/** One base of the SSH host. */
export type HostBase = (typeof HOST_BASE_VARIANTS)[number];

/**
 * The bases the variant run takes the host-base rows (the shell-sensitive, install and probe rows) to: Ubuntu 18.04's
 * glibc is below the server's, so its rows are the prerequisite rows of their own, and Debian 12's rows are its own.
 */
export const VARIANT_HOST_BASES: readonly HostBase[] = ['ubuntu-26.04'];

/** Whether `value` names a base of the SSH host. */
function isHostBase(value: string): value is HostBase {
  return (HOST_BASE_VARIANTS as readonly string[]).includes(value);
}

/**
 * The base this process starts its SSH host from, from `HARNESS_HOST_BASE`; `alpine` when it is unset. A name that is
 * none of the bases throws.
 */
export function hostBaseOf(
  environment: Readonly<Record<string, string | undefined>>,
): HostBase {
  const named = environment.HARNESS_HOST_BASE;
  if (named === undefined || named === '') {
    return 'alpine';
  }
  if (!isHostBase(named)) {
    throw new Error(`HARNESS_HOST_BASE names no host base: ${named}`);
  }
  return named;
}

/** Whether this process's SSH host is of `base`, for a row that holds on one base only (`HARNESS_HOST_BASE`). */
export function hostBaseIs(
  base: HostBase,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return hostBaseOf(environment) === base;
}
