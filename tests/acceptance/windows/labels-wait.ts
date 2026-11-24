/**
 * @fileoverview The wait for the labels a window shows of its host, the remote indicator and the title, which are drawn
 * after its connect ended (card #2970): read again within a bound, with the reads and when each was taken, so that a miss
 * says what each label showed and a late pass says how late. It imports nothing from the harness, so that the tools
 * project can test it.
 */

/** The clock, the pause and the output of the wait, which a test replaces. */
export interface LabelsEnvironment {
  now(): number;
  pause(milliseconds: number): Promise<void>;
  report(line: string): void;
}

const REAL_ENVIRONMENT: LabelsEnvironment = {
  now: Date.now,
  pause: milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)),
  report: line => {
    console.log(line);
  },
};

/** How long a window's labels get to read its host after its connect ended. */
const LABELS_MILLISECONDS = 10_000;

/** How many of the last reads a miss names. */
const NAMED_READS = 5;

/**
 * The labels read by `read` once the indicator holds `indicatorText` and the title holds `titleText`, read again every
 * half a second for up to `LABELS_MILLISECONDS`, with the last reads and when each was taken. A pass that needed a second
 * read is told with its seconds; a label that never reads it returns the last labels and reads, which the caller's
 * comparison fails with.
 */
export async function labelsWithin(
  read: () => Promise<{indicator: string; title: string}>,
  window: string,
  indicatorText: string,
  titleText: string,
  environment: LabelsEnvironment = REAL_ENVIRONMENT,
): Promise<{indicator: string; title: string; reads: string}> {
  const started = environment.now();
  const reads: string[] = [];
  for (;;) {
    const shown = await read();
    const milliseconds = environment.now() - started;
    reads.push(
      `[+${(milliseconds / 1000).toFixed(1)} s] indicator ${JSON.stringify(shown.indicator)}, title ${JSON.stringify(shown.title)}`,
    );
    const matched =
      shown.indicator.includes(indicatorText) &&
      shown.title.includes(titleText);
    if (matched && reads.length > 1) {
      environment.report(
        `${window}: the labels read ${JSON.stringify(indicatorText)} and ${JSON.stringify(titleText)} only ${(milliseconds / 1000).toFixed(1)} s after the connect ended`,
      );
    }
    if (matched || milliseconds >= LABELS_MILLISECONDS) {
      return {...shown, reads: reads.slice(-NAMED_READS).join('; ')};
    }
    await environment.pause(500);
  }
}
