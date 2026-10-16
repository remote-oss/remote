/**
 * @fileoverview The port the CLI bridge runs the dev container CLI through: one run of the program with its
 * arguments, every line of its output told as it comes, and the first line of stdout and the exit status at the end.
 */

/** One line the CLI wrote, and the stream it wrote it to. */
export interface CliLine {
  stream: 'stdout' | 'stderr';
  line: string;
}

/** How a run ended: the process ran to its end (the status is null after a signal), or could not start. */
export type CliRun =
  | {kind: 'ran'; result: string | undefined; status: number | null}
  | {kind: 'spawnFailed'; message: string};

/**
 * How a run's input is presented to its reader: a reader whose line discipline echoes the typed input back into the
 * run's own output (`echoed`), or nothing that does and the surface echoes the printable keys itself (`plain`).
 */
export type StdinPresentation = 'echoed' | 'plain';

/** The writer for a run's stdin, with the run's input presentation. */
export type StdinOf = (
  write: (data: string) => void,
  presentation: StdinPresentation,
) => void;

/** The dev container CLI as a program. */
export interface CliHost {
  /**
   * Runs the CLI with `cliArguments`. An abort ends the CLI and its children, and the run then ends with status
   * null. `result` is the first line of stdout, when there was one. `onStdin`, when given, gets the writer for the
   * CLI's stdin and the run's input presentation once the host knows it: `echoed` when the preload loaded
   * `node-pty` (its marker says so), `plain` when it didn't or no marker came.
   */
  run(
    cliArguments: readonly string[],
    onLine: (line: CliLine) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
  ): Promise<CliRun>;
}
