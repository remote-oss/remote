import {createHash} from 'node:crypto';

/**
 * A clock the lock decisions read and wait on. A test drives it: `now` reports the current
 * time and `wait` settles when the test advances the clock past the deadline.
 */
export interface Clock {
  now(): number;
  /** Settle once the clock has advanced by `millisecond` milliseconds. */
  wait(millisecond: number): Promise<void>;
}

/**
 * The file operations the client lock needs on the host, as promises so a test can fake them.
 * `ageMilliseconds` is `undefined` when the file is absent.
 */
export interface LockFilePort {
  createExclusive(path: string, text: string): Promise<'created' | 'exists'>;
  ageMilliseconds(path: string): Promise<number | undefined>;
  remove(path: string): Promise<void>;
}

/**
 * The tunables of the client-lock wait, with their shipped defaults: poll about every half a
 * second, give up after two minutes, take over a file that is four minutes old.
 */
export interface ClientLockOptions {
  pollMilliseconds: number;
  giveUpMilliseconds: number;
  takeoverAgeMilliseconds: number;
}

const DEFAULT_OPTIONS: ClientLockOptions = {
  pollMilliseconds: 500,
  giveUpMilliseconds: 120000,
  takeoverAgeMilliseconds: 240000,
};

/**
 * The lock's file name from the host identity: the first eight lower-case hex characters of the
 * identity's sha256, stable for the same identity. The name is shared with no other tool; only its
 * stability matters (BR-6).
 */
export function lockIdFor(hostIdentity: string): string {
  return createHash('sha256').update(hostIdentity).digest('hex').slice(0, 8);
}

/**
 * Hold the client lock for `work`: try to create the lock file, and when another window holds
 * it, wait for it to be released or old enough to take over, giving up after the limit. The
 * holder never refreshes the file: on a clean end it removes it, and a dead holder is taken
 * over only by the age rule. `onWaiting` is called once, before the first poll. The error of
 * `work` propagates and the file is still removed.
 */
export async function withClientLock<T>(
  port: LockFilePort,
  folder: string,
  hostIdentity: string,
  clock: Clock,
  work: () => Promise<T>,
  onWaiting: () => void,
  options?: ClientLockOptions,
): Promise<{kind: 'done'; value: T} | {kind: 'lockTimeout'}> {
  const merged: ClientLockOptions = {...DEFAULT_OPTIONS, ...options};
  const path = `${folder}/${lockIdFor(hostIdentity)}.lock`;
  const started = clock.now();
  let waitingNotified = false;
  for (;;) {
    const created = await port.createExclusive(path, hostIdentity);
    if (created === 'created') {
      try {
        return {kind: 'done', value: await work()};
      } finally {
        await port.remove(path);
      }
    }
    const fileAge = await port.ageMilliseconds(path);
    if (fileAge !== undefined && fileAge >= merged.takeoverAgeMilliseconds) {
      await port.remove(path);
      continue;
    }
    if (!waitingNotified) {
      waitingNotified = true;
      onWaiting();
    }
    if (clock.now() - started >= merged.giveUpMilliseconds) {
      return {kind: 'lockTimeout'};
    }
    await clock.wait(merged.pollMilliseconds);
  }
}
