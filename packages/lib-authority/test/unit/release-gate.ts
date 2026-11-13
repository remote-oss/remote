/** A promise and the function that settles it. */
export function releaseGate(): {promise: Promise<void>; release: () => void} {
  const gate = {promise: Promise.resolve(), release: (): void => undefined};
  gate.promise = new Promise<void>(resolveGate => {
    gate.release = () => {
      resolveGate();
    };
  });
  return gate;
}
