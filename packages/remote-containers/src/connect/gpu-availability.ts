/**
 * @fileoverview The value of `dev.containers.gpuAvailability`, which the CLI's `up` takes as `--gpu-availability`.
 */

/** The availability when the setting has no string value. */
const DEFAULT_AVAILABILITY = 'detect';

/**
 * The user's value when it is a string, else `detect`. A string outside `all`, `detect` and `none` goes as written, for
 * the CLI to refuse before it makes a container.
 */
export function gpuAvailabilityOf(value: unknown): string {
  return typeof value === 'string' ? value : DEFAULT_AVAILABILITY;
}
