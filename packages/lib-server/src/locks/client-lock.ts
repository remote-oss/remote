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
 * `createExclusive` makes an empty file. `ageMilliseconds` and `modifiedMilliseconds` (the file's
 * modification time) are `undefined` when the file is absent. `removeIfModified` removes the file
 * only while its modification time is `modified`.
 */
export interface LockFilePort {
  createExclusive(path: string): Promise<'created' | 'exists'>;
  ageMilliseconds(path: string): Promise<number | undefined>;
  modifiedMilliseconds(path: string): Promise<number | undefined>;
  remove(path: string): Promise<void>;
  removeIfModified(path: string, modified: number | undefined): Promise<void>;
}

/**
 * The tunables of the client-lock wait, with their shipped defaults: poll about every half a
 * second, give up after two minutes, take over a file that is four minutes old, break a takeover
 * ticket that is ten seconds old. A wait ends early when `cancellation` aborts.
 */
export interface ClientLockOptions {
  pollMilliseconds: number;
  giveUpMilliseconds: number;
  takeoverAgeMilliseconds: number;
  ticketStaleMilliseconds: number;
  cancellation?: AbortSignal;
}

const DEFAULT_OPTIONS: ClientLockOptions = {
  pollMilliseconds: 500,
  giveUpMilliseconds: 120000,
  takeoverAgeMilliseconds: 240000,
  ticketStaleMilliseconds: 10000,
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
 * Takes over the stale lock at `path` under its ticket, one takeover at a time: the lock's age is
 * read again under the ticket, and the lock is removed only while it is still stale. Whether the
 * ticket was this caller's; a ticket another caller holds is broken once it is old enough.
 */
async function tookOverUnderTicket(
  port: LockFilePort,
  path: string,
  options: ClientLockOptions,
): Promise<boolean> {
  const ticket = `${path}.takeover`;
  if ((await port.createExclusive(ticket)) === 'exists') {
    const ticketAge = await port.ageMilliseconds(ticket);
    if (
      ticketAge !== undefined &&
      ticketAge >= options.ticketStaleMilliseconds
    ) {
      await port.remove(ticket);
    }
    return false;
  }
  try {
    const lockAge = await port.ageMilliseconds(path);
    if (lockAge !== undefined && lockAge >= options.takeoverAgeMilliseconds) {
      await port.remove(path);
    }
  } finally {
    await port.remove(ticket);
  }
  return true;
}

/**
 * Hold the client lock for `work`: try to create the lock file, and when another window holds
 * it, wait for it to be released or old enough to take over, giving up after the limit or at
 * the cancellation, also one that comes while the file is created, which then removes it. The
 * holder never refreshes the file: on a clean end it removes it, and a
 * dead holder is taken over only by the age rule, under a ticket. The holder's removal leaves a
 * file whose modification time is not the one read at its create, since that file is another
 * window's after a takeover; `work` is given that time. `onWaiting` is called once, before the
 * first poll. The error of `work` propagates and the file is still removed.
 */
export async function withClientLock<T>(
  port: LockFilePort,
  folder: string,
  hostIdentity: string,
  clock: Clock,
  work: (modified: number | undefined) => Promise<T>,
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
    if ((await port.createExclusive(path)) === 'created') {
      const modified = await port.modifiedMilliseconds(path);
      if (isCancelled(merged)) {
        // Cancelled while the file was being created: the file is this caller's, and no work follows to give it back.
        await port.removeIfModified(path, modified);
        return {kind: 'cancelled'};
      }
      try {
        return {kind: 'done', value: await work(modified)};
      } finally {
        await port.removeIfModified(path, modified);
      }
    }
    const fileAge = await port.ageMilliseconds(path);
    if (
      fileAge !== undefined &&
      fileAge >= merged.takeoverAgeMilliseconds &&
      (await tookOverUnderTicket(port, path, merged))
    ) {
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
