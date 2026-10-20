/**
 * @fileoverview An abort of its own that follows another: the signal a run hands to what it starts, so that the run
 * can also end it itself, and the way to stop following.
 */

/** The own controller, which is aborted when `cancellation` is, and the way to stop following `cancellation`. */
export function linkedAbort(cancellation: AbortSignal): {
  own: AbortController;
  release: () => void;
} {
  const own = new AbortController();
  function forward(): void {
    own.abort();
  }
  if (cancellation.aborted) {
    forward();
  }
  cancellation.addEventListener('abort', forward, {once: true});
  return {
    own,
    release: () => {
      cancellation.removeEventListener('abort', forward);
    },
  };
}
