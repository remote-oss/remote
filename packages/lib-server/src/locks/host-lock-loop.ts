import type {Clock} from './client-lock.ts';

/**
 * Step one host-lock attempt: the step either returns its result or reports the host lock as
 * taken, in which case the loop retries.
 */
export type HostLockStep<T> = () => Promise<
  {kind: 'result'; value: T} | {kind: 'lockBusy'}
>;

/**
 * Drive the host-lock wait: attempt once immediately, and after each busy result report the
 * attempt number and wait the interval, up to `attempts` busy results. After the last attempt
 * there is no wait. The host lock is bounded by the attempt count, so it needs no R-79 rule.
 */
export async function hostLockLoop<T>(
  step: HostLockStep<T>,
  clock: Clock,
  onRetry: (attempt: number) => void,
  attempts = 30,
  intervalMilliseconds = 1000,
): Promise<{kind: 'done'; value: T} | {kind: 'retriesExhausted'}> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await step();
    if (result.kind === 'result') {
      return {kind: 'done', value: result.value};
    }
    if (attempt >= attempts) {
      return {kind: 'retriesExhausted'};
    }
    onRetry(attempt);
    await clock.wait(intervalMilliseconds);
  }
}
