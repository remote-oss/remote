/**
 * @fileoverview The timer of a query that does not run while a person is answering: it stops when a box opens and
 * starts again with its full time when the last box closes. A person's answer is not a wait of ours.
 */

/** What tells how many boxes are open. */
export interface BoxCounter {
  /** How many boxes are open now. */
  openBoxes(): number;
  /** Calls `listener` with the number of open boxes each time it changes; gives the way to stop. */
  onBoxes(listener: (open: number) => void): () => void;
}

/**
 * A timer of `milliseconds` over `setTimer` that waits out the boxes of `boxes`; gives the way to cancel it. Without
 * `boxes` it is `setTimer` itself.
 */
export function pausableTimer(
  setTimer: (milliseconds: number, callback: () => void) => () => void,
  milliseconds: number,
  callback: () => void,
  boxes: BoxCounter | undefined,
): () => void {
  let cancel: (() => void) | undefined;
  function startTimer(): void {
    cancel = setTimer(milliseconds, callback);
  }
  function disarm(): void {
    cancel?.();
    cancel = undefined;
  }
  if (boxes === undefined || boxes.openBoxes() === 0) {
    startTimer();
  }
  const stopListening = boxes?.onBoxes(open => {
    if (open > 0) {
      disarm();
    } else if (cancel === undefined) {
      startTimer();
    }
  });
  return () => {
    disarm();
    stopListening?.();
  };
}
