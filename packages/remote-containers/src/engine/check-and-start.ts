/**
 * @fileoverview C2's check-and-start step: the check runs; when it fails because the daemon is not up and the host can
 * start Docker Desktop, the application is started (unless it already runs) and the check is repeated on a bounded
 * schedule. Docker Desktop's processes are never stopped. Cancelling ends the repeats at once.
 */

import {
  type DesktopData,
  mayRecheck,
  recheckBoundOf,
  shouldStartDesktop,
} from './docker-desktop.ts';

/** What one run of the check came to. */
export type CheckResult = {passed: true} | {passed: false; errorText: string};

/** What the step needs of its host to start Docker Desktop and wait for it. */
export interface DesktopPorts {
  /** The host's start data; none for a host that cannot start Docker Desktop. */
  data: DesktopData | undefined;
  /** Whether Docker Desktop is installed at its standard location. */
  installed(): Promise<boolean>;
  /** Whether its process is listed now. */
  running(): Promise<boolean>;
  /** Starts it detached and in the background; a program that cannot be started is no failure of the step. */
  start(): Promise<void>;
  /** Waits `milliseconds`, or less when `cancellation` ends. */
  wait(milliseconds: number, cancellation: AbortSignal): Promise<void>;
  /** The time now, in milliseconds. */
  now(): number;
}

/** What the step needs of its surroundings. */
export interface CheckAndStartPorts extends DesktopPorts {
  /** Runs the check once. */
  check(cancellation: AbortSignal): Promise<CheckResult>;
}

/** How the step ended: the check passed, its last failure stands, or the step was cancelled. */
export type CheckAndStartOutcome =
  {kind: 'ok'} | {kind: 'failed'; errorText: string} | {kind: 'stopped'};

/** Whether the signal has ended; read through a call because it changes while the step waits. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Runs the check, and when it fails for the reason Docker Desktop answers, starts it and repeats the check. */
export async function checkAndStart(
  ports: CheckAndStartPorts,
  cancellation: AbortSignal,
): Promise<CheckAndStartOutcome> {
  const first = await ports.check(cancellation);
  if (first.passed) {
    return {kind: 'ok'};
  }
  const {data} = ports;
  if (
    data === undefined ||
    !shouldStartDesktop(data, await ports.installed(), first.errorText)
  ) {
    return {kind: 'failed', errorText: first.errorText};
  }
  const running = await ports.running();
  const began = ports.now();
  if (!running) {
    await ports.start();
  }
  const bound = recheckBoundOf(data, !running);
  let last = first.errorText;
  for (let done = 0; mayRecheck(bound, done, ports.now() - began); done += 1) {
    await ports.wait(data.recheckIntervalMilliseconds, cancellation);
    if (isAborted(cancellation)) {
      return {kind: 'stopped'};
    }
    const again = await ports.check(cancellation);
    if (again.passed) {
      return {kind: 'ok'};
    }
    last = again.errorText;
  }
  return {kind: 'failed', errorText: last};
}
