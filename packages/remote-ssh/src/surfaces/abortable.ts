/**
 * @fileoverview The wait for a modal's answer that ends early when the connect gives up.
 */

/** The answer, or `onAbort` when `cancellation` fires first; the listener is gone when this settles. */
export async function answeredOrAborted<Answer>(
  answered: Promise<Answer>,
  cancellation: AbortSignal,
  onAbort: Answer,
): Promise<Answer> {
  const waiting: {stop?: () => void} = {};
  const aborted = new Promise<Answer>(resolve => {
    function listener(): void {
      resolve(onAbort);
    }
    cancellation.addEventListener('abort', listener, {once: true});
    waiting.stop = () => {
      cancellation.removeEventListener('abort', listener);
    };
  });
  try {
    return await Promise.race([answered, aborted]);
  } finally {
    waiting.stop?.();
  }
}
