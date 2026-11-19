/**
 * @fileoverview The steps of a run's preparation, each timed and bounded: a step that has not finished
 * within its limit fails the run with its name, so that a stall on a hosted runner ends the part in minutes with a
 * message and not at the job's own limit, and every step prints how long it took, so that a stall names its step.
 */

/** The clock and the output of a step, which a test replaces. */
export interface StepEnvironment {
  now(): number;
  report(line: string): void;
}

const REAL_ENVIRONMENT: StepEnvironment = {
  now: Date.now,
  report: line => {
    console.log(line);
  },
};

/** How long a step of the preparation gets: a healthy part prepares everything in under a minute. */
export const PREPARE_STEP_MILLISECONDS = 600_000;

/** `milliseconds` as whole seconds. */
function secondsOf(milliseconds: number): string {
  return String(Math.round(milliseconds / 1000));
}

/**
 * Runs `work` and prints how long it took. When it has not finished within `limitMilliseconds` the step fails naming
 * itself; a step that throws is printed with its seconds and its error stands. A step that blocks the process, such as
 * a synchronous command, is timed but cannot be interrupted here: it is bounded by the limit of its command.
 */
export async function timedStep<Value>(
  name: string,
  limitMilliseconds: number,
  work: () => Promise<Value> | Value,
  environment: StepEnvironment = REAL_ENVIRONMENT,
): Promise<Value> {
  const started = environment.now();
  let timer: NodeJS.Timeout | undefined;
  const silent = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `acceptance: the preparation step "${name}" had not finished after ${secondsOf(limitMilliseconds)} s, so the run stops here and not at the job's limit`,
        ),
      );
    }, limitMilliseconds);
  });
  try {
    const value = await Promise.race([(async () => work())(), silent]);
    environment.report(
      `acceptance: prepare: ${name} done in ${secondsOf(environment.now() - started)} s`,
    );
    return value;
  } catch (caught) {
    environment.report(
      `acceptance: prepare: ${name} failed after ${secondsOf(environment.now() - started)} s`,
    );
    throw caught;
  } finally {
    clearTimeout(timer);
  }
}

/** How long the process gets to end by itself once the run has returned. */
export const END_GRACE_MILLISECONDS = 30_000;

/**
 * Ends the process `graceMilliseconds` after it is called, with the exit code the run set, unless it has ended by
 * itself: a step that outlived its limit leaves its work running, a download or a command that holds the process open
 * to the job's own limit. The timer does not hold the process open either, and the timer is given back for a test.
 */
export function endAfterGrace(
  graceMilliseconds = END_GRACE_MILLISECONDS,
  exit: () => void = () => {
    process.exit();
  },
): NodeJS.Timeout {
  const timer = setTimeout(exit, graceMilliseconds);
  timer.unref();
  return timer;
}
