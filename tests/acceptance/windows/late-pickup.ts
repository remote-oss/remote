/**
 * @fileoverview A read of a view after a change of a settings file, which the editor can pick up late (card #2861): on
 * the Windows runner it has held the old value for more than 20 s after the file held the new one, and then taken the
 * new one with nothing else changed. It imports nothing from the harness or the editor, so that the tools project can
 * test it.
 */

/** How long a change of a settings file gets to reach the view: the editor has been seen taking up to about 80 s. */
const PICKUP_MILLISECONDS = 90_000;

/** The clock and the output of a wait, which a test replaces. */
export interface PickupEnvironment {
  now(): number;
  report(line: string): void;
}

const REAL_ENVIRONMENT: PickupEnvironment = {
  now: Date.now,
  report: line => {
    console.log(line);
  },
};

/**
 * Whether `look`, a read that gives up after 20 s, finds `what` within `PICKUP_MILLISECONDS`, reading again until it
 * does. A pass after the first read gave up is a late pickup, which is printed and added to `notes` with its seconds,
 * and a read that never finds it adds that to `notes`, so that the row's failure says which of the two it was.
 */
export async function pickedUp(
  what: string,
  look: () => Promise<boolean>,
  notes: string[],
  environment: PickupEnvironment = REAL_ENVIRONMENT,
): Promise<boolean> {
  const started = environment.now();
  const onTime = await look();
  let found = onTime;
  while (!found && environment.now() - started < PICKUP_MILLISECONDS) {
    found = await look();
  }
  const seconds = Math.round((environment.now() - started) / 1000);
  if (found && !onTime) {
    const note = `${what}: late pickup after ${String(seconds)} s`;
    environment.report(note);
    notes.push(note);
  }
  if (!found) {
    const note = `${what}: never picked up in ${String(seconds)} s`;
    environment.report(note);
    notes.push(note);
  }
  return found;
}
