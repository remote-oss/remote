/**
 * @fileoverview The host variants of the acceptance tests: the download tools a host may have, and the one this
 * process runs, named by the harness variable of the run.
 */

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
