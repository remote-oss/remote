/**
 * @fileoverview A pull that tries again, for an image the rows first pull from a public registry in the middle of a
 * launch, so that a registry's passing failure fails no row. It imports nothing from the harness or the editor, so that
 * the tools project can test it.
 */

/**
 * Runs `pull` until it succeeds, at most `attempts` times, waiting with `pause` between two tries, and gives how many
 * tries it took. When every try fails, the last try's error is thrown.
 */
export async function pulledWithRetries(
  pull: () => Promise<void>,
  attempts: number,
  pause: () => Promise<void>,
): Promise<number> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pull();
      return attempt;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await pause();
    }
  }
}
