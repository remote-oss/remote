/** How long the dialog a row answered may stay the one on the page before the row fails; the wait is bounded. */
export const ANSWERED_DIALOG_MILLISECONDS = 60_000;

/** Which dialog the page shows: none, the one that was marked when the row answered it, or another one. */
export type DialogIdentity = 'none' | 'answered' | 'another';

/** What the wait for the next dialog is made of. */
export interface AfterAnsweredPorts<Found> {
  /** The dialog on the page, waiting up to the given milliseconds; it rejects when there is none. */
  look(milliseconds: number): Promise<Found>;
  messageOf(found: Found): string;
  /** Marks the dialog on the page, once, before the wait; the page may hold none. */
  mark?(): Promise<void>;
  /** Which dialog the page shows now, read against the mark. */
  identity?(): Promise<DialogIdentity>;
  /** The time in milliseconds, and how long the wait lasts. */
  now(): number;
  bound: number;
}

/**
 * The next dialog of window `name` after the one saying `answered` was answered: the answered dialog stays on the page for
 * a moment while it closes, so a dialog with the same message is not the next one. The wait is bounded, and it fails
 * naming which it was: the same question shown again after the page held no dialog, or as a dialog other than the answered
 * one (core asked a second time, a behaviour of the product), no dialog at all (the next question never came), or the
 * answered dialog itself never closing (the press did not close it).
 */
export async function afterAnswered<Found>(
  name: string,
  answered: string,
  ports: AfterAnsweredPorts<Found>,
): Promise<Found> {
  await ports.mark?.();
  let gone = false;
  let lastIdentity: DialogIdentity | undefined;
  const deadline = ports.now() + ports.bound;
  while (ports.now() < deadline) {
    const shown = await ports.look(300).then(
      found => ({found}),
      () => undefined,
    );
    if (shown === undefined) {
      gone = true;
    } else if (ports.messageOf(shown.found) !== answered) {
      return shown.found;
    } else {
      lastIdentity = await ports.identity?.();
      if (lastIdentity === 'another') {
        throw new Error(
          `window ${name}: same question again: ${JSON.stringify(answered)} is shown by a new dialog, not the one that was answered Cancel`,
        );
      }
      if (gone) {
        throw new Error(
          `window ${name}: same question again: ${JSON.stringify(answered)} was on the page again after the page held no dialog, once it had been answered Cancel`,
        );
      }
    }
  }
  const seconds = String(ports.bound / 1000);
  throw new Error(
    gone
      ? `window ${name}: no next dialog: the page held no dialog for ${seconds} s after ${JSON.stringify(answered)} was answered Cancel`
      : `window ${name}: stale dialog never closed: ${JSON.stringify(answered)} was still the dialog on the page ${seconds} s after it was answered Cancel${lastIdentity === 'answered' ? '; it is the dialog that was answered, so the press did not close it' : ''}`,
  );
}
