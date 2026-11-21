/**
 * @fileoverview The wait for the text of "Terminal: Show Environment Contributions" to carry an entry (card #2923). The
 * command writes its list when it runs, so a list taken before an extension has contributed stays without the entry
 * however long it is read; the wait therefore runs the command again every few seconds, and when it ends without the entry
 * it says what it read last and what each run gave, so that an extension that never contributed (the product) is told from a
 * first run that came early (the harness). It imports nothing from the harness or the editor, so that the tools project can
 * test it.
 */

/** The clock and the pause of the wait, which a test replaces. */
interface PollingEnvironment {
  now(): number;
  pause(milliseconds: number): Promise<void>;
}

/** What one run of the command gave. */
interface ContributionRun {
  /** Seconds from the start of the wait to the run. */
  seconds: number;
  /** What the run and the reads after it showed, in words. */
  result: string;
}

/** The end of the wait: the text that carried the entry, or the last text read, and every run. */
export interface ContributionsOutcome {
  found: boolean;
  text: string;
  runs: ContributionRun[];
}

/** How the wait runs the command and reads the editor. */
export interface ContributionPolling {
  /** Runs "Show Environment Contributions". */
  show(): Promise<void>;
  /** The text of the active editor, or none when no editor is active. */
  read(): Promise<string | null | undefined>;
  /** The entry the text must carry. */
  wanted: string;
  /** How long the whole wait lasts. */
  milliseconds: number;
  /** How long a run's text is read before the command runs again. */
  perRunMilliseconds: number;
  /** The pause between two reads of a run. */
  everyMilliseconds: number;
  environment: PollingEnvironment;
}

/**
 * Runs the command and reads the editor's text until it carries `wanted`, running the command again when a run's text has
 * not after `perRunMilliseconds`, until `milliseconds` are over. A run or a read that fails is kept as its words and the
 * wait goes on.
 */
export async function contributionsAfterRuns(
  options: ContributionPolling,
): Promise<ContributionsOutcome> {
  const {environment, wanted} = options;
  const started = environment.now();
  const runs: ContributionRun[] = [];
  let text = '';
  while (environment.now() - started <= options.milliseconds) {
    const seconds = (environment.now() - started) / 1000;
    let shown = 'the command ran';
    try {
      await options.show();
    } catch (caught) {
      shown = `the command failed: ${String(caught)}`;
    }
    const readFrom = environment.now();
    let noted: string;
    for (;;) {
      try {
        text = (await options.read()) ?? '';
        noted = `the editor held ${String(text.length)} characters ${text.includes(wanted) ? 'with' : 'without'} ${wanted}`;
      } catch (caught) {
        noted = `the read failed: ${String(caught)}`;
      }
      if (text.includes(wanted)) {
        runs.push({seconds, result: `${shown}; ${noted}`});
        return {found: true, text, runs};
      }
      if (
        environment.now() - readFrom >= options.perRunMilliseconds ||
        environment.now() - started > options.milliseconds
      ) {
        break;
      }
      await environment.pause(options.everyMilliseconds);
    }
    runs.push({seconds, result: `${shown}; ${noted}`});
  }
  return {found: false, text, runs};
}

/** How many runs, how long a text and how long a run's words the failure keeps. */
const KEPT_RUNS = 12;
const KEPT_TEXT = 800;
const KEPT_RESULT = 160;

/**
 * The failure of a wait that ended without the entry: how many times the command ran, the last text read and what the
 * first runs gave, bounded by construction.
 */
export function contributionsFailure(
  outcome: ContributionsOutcome,
  wanted: string,
  seconds: number,
): string {
  const kept = outcome.runs
    .slice(0, KEPT_RUNS)
    .map(
      each =>
        `[+${each.seconds.toFixed(1)} s] ${each.result.slice(0, KEPT_RESULT)}`,
    );
  const left = outcome.runs.length - kept.length;
  return [
    `timed out waiting for the environment contributions to carry ${wanted}: the command ran ${String(outcome.runs.length)} times in ${String(seconds)} s`,
    `the last text read (${String(outcome.text.length)} characters, the first ${String(KEPT_TEXT)} shown): ${JSON.stringify(outcome.text.slice(0, KEPT_TEXT))}`,
    ...kept,
    ...(left > 0 ? [`and ${String(left)} more runs`] : []),
  ].join('\n');
}
