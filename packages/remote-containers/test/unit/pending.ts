/** A promise that a row settles when it likes. */
export interface Pending<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

/** A promise with the means to settle it. */
export function pendingOf<Value>(): Pending<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return {promise, resolve, reject};
}

/** Lets everything that is ready to run, run: the microtasks and the callbacks of this turn of the event loop. */
export function settled(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

/** Runs `work` and gives the unhandled rejections seen by the end of a turn of the event loop. */
export async function unhandledDuring(
  work: () => Promise<void>,
): Promise<unknown[]> {
  const seen: unknown[] = [];
  function record(reason: unknown): void {
    seen.push(reason);
  }
  process.on('unhandledRejection', record);
  await work()
    .finally(settled)
    .finally(() => {
      process.off('unhandledRejection', record);
    });
  return seen;
}
