/**
 * @fileoverview One engine call of a clone's resolve, read by its exit status alone: what it printed when it exited 0,
 * or the text that says why it didn't.
 */

import type {EngineHost, EngineOptions} from '../engine/engine-host.ts';

/** What a step needs: the engine, and the options of this resolve. */
export interface EngineStepPorts {
  engine: Pick<EngineHost, 'run'>;
  options: EngineOptions;
}

/** A step's result: what it printed when it exited 0, or why it didn't. */
export type StepResult =
  {succeeded: true; stdout: string} | {succeeded: false; detail: string};

/** Runs one engine step; a failure's detail is what it wrote to stderr, or which step exited and how. */
export async function stepOf(
  ports: EngineStepPorts,
  argv: readonly string[],
): Promise<StepResult> {
  const outcome = await ports.engine.run(argv, {kind: 'none'}, ports.options);
  if (outcome.kind === 'failed') {
    return {succeeded: false, detail: outcome.detail};
  }
  if (outcome.status === 0) {
    return {succeeded: true, stdout: outcome.stdout};
  }
  const stderr = outcome.stderr.trim();
  return {
    succeeded: false,
    detail:
      stderr === ''
        ? `docker ${String(argv[0])} exited with ${String(outcome.status)}`
        : stderr,
  };
}
