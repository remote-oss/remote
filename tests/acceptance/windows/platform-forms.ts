/**
 * @fileoverview The forms a value takes on the platform of the run, for the rows that compare what a window shows
 * (card #2828): core lays the buttons of a dialog out by the platform, and the product names an engine that is not the
 * CLI's default endpoint after the window's name, as the run's engine is on the Windows job (the stand-in at a named
 * TCP address, reading-2511-desktop-stand-in). A row writes the Linux form and these give the form of the platform, so
 * a row still fails on the wrong form.
 */

/**
 * The buttons of a core dialog in the order the platform lays them out. `linuxOrder` is the order observed on Linux, which
 * puts the primary button last; Windows puts it first and leaves the others as they are (observed on the Windows job).
 * macOS is not observed (its job never reached these rows), so it is taken as Linux.
 */
export function coreButtons(
  linuxOrder: readonly string[],
  platform: string = process.platform,
): string[] {
  const primary = linuxOrder.at(-1);
  return platform === 'win32' && primary !== undefined
    ? [primary, ...linuxOrder.slice(0, -1)]
    : [...linuxOrder];
}

/**
 * The part the product adds to a window's name for the run's engine: ` @ <address>` when the run's engine is a named
 * endpoint, which `address` (the run's `DOCKER_HOST`) is on the Windows job, and none on a run that uses the default.
 */
export function engineSuffix(
  address: string | undefined = process.env.DOCKER_HOST,
  platform: string = process.platform,
): string {
  return platform === 'win32' && address?.startsWith('tcp://') === true
    ? ` @ ${address}`
    : '';
}

/**
 * How many characters of a remote label the status bar shows before it cuts the label with an ellipsis. Observed, not
 * documented: 40 characters, read off the indicators of the Windows job (`Dev Container: c43-stop @ tcp://127.0.0.…` and
 * `Dev Container: c43-restart @ tcp://127.0…`), so a row that compares a label says the label before the cut on a mismatch
 * ({@link labelNote}), and a different cut shows itself.
 */
const SHOWN_LABEL_LENGTH = 40;

/** A remote label as the status bar shows it: cut to its first characters and an ellipsis when it is longer. */
export function shownLabel(label: string): string {
  return label.length > SHOWN_LABEL_LENGTH
    ? `${label.slice(0, SHOWN_LABEL_LENGTH)}…`
    : label;
}

/** The label of a dev container window named `name` as the status bar shows it on this run: the name, the engine's suffix and the cut. */
export function containerLabel(
  name: string,
  address?: string,
  platform: string = process.platform,
): string {
  return shownLabel(
    `Dev Container: ${name}${engineSuffix(address ?? process.env.DOCKER_HOST, platform)}`,
  );
}

/** What a row adds to the message of a label that did not match: the label as the product writes it, before the status bar's cut. */
export function labelNote(
  name: string,
  address?: string,
  platform: string = process.platform,
): string {
  return `the label of ${name} before the status bar's cut is "Dev Container: ${name}${engineSuffix(address ?? process.env.DOCKER_HOST, platform)}", which is shown cut to its first ${String(SHOWN_LABEL_LENGTH)} characters and an ellipsis`;
}
