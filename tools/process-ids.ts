/**
 * @fileoverview The process ids a `pgrep` run prints, one on each line.
 */

/** The process ids in `output`, in the order printed; a line that is not a whole number is not an id. */
export function processIdsOf(output: string): number[] {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+$/.test(line))
    .map(Number);
}
