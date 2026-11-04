/**
 * @fileoverview A promise that is settled from outside.
 */

/** A promise with the way to settle it. */
export function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  const gates: Array<(value: Value) => void> = [];
  const promise = new Promise<Value>(resolve => {
    gates.push(resolve);
  });
  const [resolve] = gates as [(value: Value) => void];
  return {promise, resolve};
}
