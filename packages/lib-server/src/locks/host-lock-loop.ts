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
 * there is no wait. The host lock is bounded by the attempt count, so it needs no deadline of its own.
 */
export async function hostLockLoop<T>(
  step: HostLockStep<T>,
  clock: Clock,
  onRetry: (attempt: number) => void,
  attempts = 30,
  intervalMilliseconds = 1000,
): Promise<{kind: 'done'; value: T} | {kind: 'retriesExhausted'}> {
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    const result = await step();
    if (result.kind === 'result') {
      return {kind: 'done', value: result.value};
    }
    onRetry(attempt);
    await clock.wait(intervalMilliseconds);
  }
  const last = await step();
  return last.kind === 'result'
    ? {kind: 'done', value: last.value}
    : {kind: 'retriesExhausted'};
}
