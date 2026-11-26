/**
 * @fileoverview Where a run of the agent writes its answers.
 */

/** Where a run writes, and the exit status it ends with. */
export interface Output {
  /** Writes `text` to the standard output. */
  stdout(text: string): void;
  /** Writes `text` to the standard error. */
  stderr(text: string): void;
}
