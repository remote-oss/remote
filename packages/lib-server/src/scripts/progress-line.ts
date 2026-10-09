/** The prefix of the progress line a bootstrap script prints while it unpacks or downloads. */
export const PROGRESS_PREFIX = 'remote-oss-server-progress';

/** The steps the progress line reports. */
export type ProgressStep = 'unpack' | 'download';

/** One parsed progress line: the step it reports and the percent, an integer 0-100. */
export interface ProgressLine {
  step: ProgressStep;
  percent: number;
}

/** Whether `word` is one of the progress steps. */
function isProgressStep(word: string): word is ProgressStep {
  return word === 'unpack' || word === 'download';
}

/**
 * Whether `value` is a percent the progress line accepts: decimal digits only, no sign, no leading
 * zero (except the value `0` itself), and at most 100.
 */
function isPercent(value: string): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  if (value.length > 1 && value.startsWith('0')) {
    return false;
  }
  return Number(value) <= 100;
}

/**
 * Read a progress line: a whole line `${PROGRESS_PREFIX} ${step} ${percent}` with exactly one space
 * between the three parts, a trailing carriage return stripped. Anything else is not a progress
 * line.
 */
export function parseProgressLine(line: string): ProgressLine | undefined {
  const text = line.replace(/\r$/, '');
  if (!text.startsWith(`${PROGRESS_PREFIX} `)) {
    return undefined;
  }
  const parts = text.split(' ');
  const step = parts[1];
  const percent = parts[2];
  if (
    parts.length !== 3 ||
    step === undefined ||
    percent === undefined ||
    !isProgressStep(step) ||
    !isPercent(percent)
  ) {
    return undefined;
  }
  return {step, percent: Number(percent)};
}

/** The progress lines of a run's output, in order; the other lines are skipped. */
export function progressLines(lines: readonly string[]): ProgressLine[] {
  const found: ProgressLine[] = [];
  for (const line of lines) {
    const parsed = parseProgressLine(line);
    if (parsed !== undefined) {
      found.push(parsed);
    }
  }
  return found;
}
