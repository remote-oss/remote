/**
 * @fileoverview The pieces the lifecycle tests share to script a host: the result block a step prints, an answer that
 * prints given lines, and a lock loop that runs its step once.
 */

import type {ScriptAnswer} from 'lib-host/testing/recording-channel';
import {type HostLockLoop, RESULT_BEGIN, RESULT_END} from '../../src/index.ts';

/** The lines of a result block with a status and facts. */
export function block(status: string, ...facts: string[]): string[] {
  return [RESULT_BEGIN, `status=${status}`, ...facts, RESULT_END];
}

/** An answer to any script that prints `output` and exits 0. */
export function answering(output: readonly string[]): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: () => true,
    lines: output,
    ending: {kind: 'exit', status: 0},
  };
}

/** The loop that runs the step once. */
export function runOnce(
  step: Parameters<HostLockLoop>[0],
): ReturnType<HostLockLoop> {
  return step();
}
