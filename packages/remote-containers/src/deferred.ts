/**
 * @fileoverview A promise that is settled from outside.
 */

/** A promise with the way to settle it. */
export function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  const gate: {resolve: (value: Value) => void} = {resolve: () => undefined};
  const promise = new Promise<Value>(resolve => {
    gate.resolve = resolve;
  });
  return {promise, resolve: value => gate.resolve(value)};
}
