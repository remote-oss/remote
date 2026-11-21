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
 * The file operations the client lock needs on the client, as promises so a test can fake them.
 * `createExclusive` makes an empty file. `ageMilliseconds` is `undefined` when the file is absent.
 */
export interface LockFilePort {
  createExclusive(path: string): Promise<'created' | 'exists'>;
  ageMilliseconds(path: string): Promise<number | undefined>;
  remove(path: string): Promise<void>;
}

/**
 * The tunables of the client-lock wait, with their shipped defaults: poll about every half a
 * second, give up after two minutes, take over a file that is four minutes old. A wait ends
 * early when `cancellation` aborts.
 */
export interface ClientLockOptions {
  pollMilliseconds: number;
  giveUpMilliseconds: number;
  takeoverAgeMilliseconds: number;
  cancellation?: AbortSignal;
}

const DEFAULT_OPTIONS: ClientLockOptions = {
  pollMilliseconds: 500,
  giveUpMilliseconds: 120000,
  takeoverAgeMilliseconds: 240000,
};

/**
 * The lock's id from the host identity: the first eight lower-case hex characters of the
 * identity's sha256, stable for the same identity. The id is shared with no other tool; only its
 * stability matters (BR-6).
 */
export function lockIdFor(hostIdentity: string): string {
  return createHash('sha256').update(hostIdentity).digest('hex').slice(0, 8);
}

/** The path of the client lock of `hostIdentity` in `folder`, the editor's temporary folder. */
export function clientLockPath(folder: string, hostIdentity: string): string {
  return `${folder}/vscode-remote-ssh-${lockIdFor(hostIdentity)}-install.lock`;
}

/** Whether the wait's cancellation has come by now; read through a call, since it changes while a create runs. */
function isCancelled(options: ClientLockOptions): boolean {
  return options.cancellation?.aborted === true;
}

/**
 * Hold the client lock for `work`: try to create the lock file, and when another window holds
 * it, wait for it to be released or old enough to take over, giving up after the limit or at
 * the cancellation, also one that comes while the file is created, which then removes it. The
 * holder never refreshes the file: on a clean end it removes it, and a
 * dead holder is taken over only by the age rule. `onWaiting` is called once, before the first
 * poll. The error of `work` propagates and the file is still removed.
 */
export async function withClientLock<T>(
  port: LockFilePort,
  folder: string,
  hostIdentity: string,
  clock: Clock,
  work: () => Promise<T>,
  onWaiting: () => void,
  options?: Partial<ClientLockOptions>,
): Promise<
  {kind: 'done'; value: T} | {kind: 'lockTimeout'} | {kind: 'cancelled'}
> {
  const merged: ClientLockOptions = {...DEFAULT_OPTIONS, ...options};
  const path = clientLockPath(folder, hostIdentity);
  const started = clock.now();
  let waitingNotified = false;
  for (;;) {
    if (isCancelled(merged)) {
      return {kind: 'cancelled'};
    }
    const created = await port.createExclusive(path);
    if (created === 'created' && isCancelled(merged)) {
      // Cancelled while the file was being created: the file is this caller's, and no work follows to give it back.
      await port.remove(path);
      return {kind: 'cancelled'};
    }
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
