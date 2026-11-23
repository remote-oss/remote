/**
 * @fileoverview The steps of a row that has never run on CI, each stamped with how long it took and bounded, so that a
 * hang names its step and a row that stops stops at the step and not at the cut of the test runner (card #3003). It
 * imports nothing from the harness, so that the tools project can test it.
 */

/** The clock and the output of a step, which a test replaces. */
export interface StampEnvironment {
  now(): number;
  report(line: string): void;
}

const REAL_ENVIRONMENT: StampEnvironment = {
  now: Date.now,
  report: line => {
    console.log(line);
  },
};

/**
 * Runs `work` for the row `rowName`, printing how long step `step` took, or how long it ran before it failed; a step that has
 * not finished within `limitMilliseconds` fails the row naming the step and the row.
 */
export async function stamped<Value>(
  rowName: string,
  step: string,
  limitMilliseconds: number,
  work: () => Promise<Value>,
  environment: StampEnvironment = REAL_ENVIRONMENT,
): Promise<Value> {
  const started = environment.now();
  function seconds(): string {
    return ((environment.now() - started) / 1000).toFixed(1);
  }
  let timer: NodeJS.Timeout | undefined;
  const silent = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${rowName}: the step "${step}" had not finished after ${String(limitMilliseconds / 1000)} s`,
        ),
      );
    }, limitMilliseconds);
  });
  try {
    const value = await Promise.race([work(), silent]);
    environment.report(`${rowName}: ${step} took ${seconds()} s`);
    return value;
  } catch (caught) {
    environment.report(`${rowName}: ${step} failed after ${seconds()} s`);
    throw caught;
  } finally {
    clearTimeout(timer);
  }
}
