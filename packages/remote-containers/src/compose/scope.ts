/**
 * @fileoverview The services a Compose configuration starts: one list that the
 * rebuild, the shutdown stop and the registry all use.
 */

/** What decides the scope. */
export interface ScopeInput {
  /** The primary service of the configuration. */
  service: string;
  /** `runServices` of the configuration, when it has one. */
  runServices: readonly string[] | undefined;
  /** The services Compose starts when none is named: those of the active profiles. */
  modelServices: readonly string[];
}

/** The services of `runServices` with the primary service added when it is not among them; the model's, when none are named. */
export function composeScopeOf(input: ScopeInput): string[] {
  const {runServices} = input;
  if (runServices === undefined || runServices.length === 0) {
    return [...input.modelServices];
  }
  return runServices.includes(input.service)
    ? [...runServices]
    : [...runServices, input.service];
}
