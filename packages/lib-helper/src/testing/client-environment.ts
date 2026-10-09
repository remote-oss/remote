import type {ClientEnvironment} from '../client/acquire.ts';
import type {FakeClock} from './fake-clock.ts';

/**
 * A client environment for tests: the caller's files, endpoints and spawner over a fake clock, nonces `nonce-1`,
 * `nonce-2`, and timings short enough for a test to move the clock past them.
 */
export function clientEnvironment(
  parts: Pick<ClientEnvironment, 'files' | 'endpoints' | 'spawn'>,
  clock: FakeClock,
): ClientEnvironment {
  let nonces = 0;
  return {
    ...parts,
    timer: (milliseconds, callback) =>
      clock.scheduler().setTimer(milliseconds, callback),
    clock: () => clock.now(),
    newNonce: () => {
      nonces += 1;
      return `nonce-${String(nonces)}`;
    },
    runtime: '/editor/code',
    endpointFolder: '/run',
    processId: 777,
    parentEnvironment: {HOME: '/home/user', UNSET: undefined},
    helloLimitMilliseconds: 500,
    startLimitMilliseconds: 2000,
    retryMilliseconds: 100,
  };
}
