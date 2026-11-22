/**
 * @fileoverview What the rows of a bounded, timed step share: a clock that each reading advances, with the lines the step
 * said, and the text of how a step ended.
 */

/** A clock that each reading advances by `step` milliseconds, and the lines said. */
export function environmentOf(step: number) {
  let now = 0;
  const said: string[] = [];
  return {
    said,
    environment: {
      now: () => {
        now += step;
        return now;
      },
      report: (line: string) => said.push(line),
    },
  };
}

/** `finished` when `ending` resolves, and the text of its failure when it rejects. */
export function endingOf(ending: Promise<unknown>): Promise<string> {
  return ending.then(
    () => 'finished',
    (caught: unknown) => String(caught),
  );
}
