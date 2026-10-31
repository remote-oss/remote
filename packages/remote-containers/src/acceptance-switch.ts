/**
 * @fileoverview The harness's own addresses: a variable names one only while `REMOTE_OSS_ACCEPTANCE` is exactly `1`, so
 * a shipped build can never be pointed at another address by its environment.
 */

/** The variable whose value `1` switches the harness's adapters on. */
const ACCEPTANCE_SWITCH = 'REMOTE_OSS_ACCEPTANCE';

/** The harness's own URL in `variable` when the switch is on and it isn't empty, else `published`. */
export function harnessUrlOf(
  environment: Readonly<Record<string, string | undefined>>,
  variable: string,
  published: string,
): string {
  const own = environment[variable];
  return environment[ACCEPTANCE_SWITCH] === '1' &&
    own !== undefined &&
    own !== ''
    ? own
    : published;
}
