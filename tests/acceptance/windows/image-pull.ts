/**
 * @fileoverview A pull that tries again, for an image the rows first pull from a public registry in the middle of a
 * launch, so that a registry's passing failure fails no row. It imports nothing from the harness or the editor, so that
 * the tools project can test it.
 */

/** A registry's passing failure: a 5xx answer, a gateway that timed out, or a connection that dropped. */
const PASSING_FAILURE =
  /\b5\d\d\b|Bad Gateway|Service Unavailable|Gateway Time-?out|TLS handshake timeout|i\/o timeout|connection reset|unexpected EOF/i;

/**
 * Whether a failed pull is worth another try: a registry's passing failure is, while an unknown image, a refused login
 * or any other answer fails the same way again and is not.
 */
export function retryablePull(error: unknown): boolean {
  return PASSING_FAILURE.test(
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Runs `pull` until it succeeds, at most `attempts` times, waiting with `pause` between two tries, and gives how many
 * tries it took. A failure that `retryable` turns down, or the last try's failure, is thrown at once.
 */
export async function pulledWithRetries(
  pull: () => Promise<void>,
  attempts: number,
  pause: () => Promise<void>,
  retryable: (error: unknown) => boolean,
): Promise<number> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pull();
      return attempt;
    } catch (error) {
      if (attempt >= attempts || !retryable(error)) {
        throw error;
      }
      await pause();
    }
  }
}
