/**
 * @fileoverview Runs one bootstrap step over a host channel and reads its result block: the one place where a
 * script's output becomes a value.
 */

import type {
  ChannelFailure,
  HostChannel,
  Interpreter,
  ScriptInput,
} from 'lib-host';
import {
  type BootstrapRequest,
  type ScriptParameters,
  scriptFor,
} from '../scripts/bootstrap.ts';
import {parseResult, type ResultBlock} from '../scripts/result-block.ts';

/** How one step ended. */
export type StepRun =
  | {kind: 'result'; block: ResultBlock; exitStatus: number}
  | {kind: 'noResultBlock'; exitStatus: number}
  | {kind: 'channelFailed'; failure: ChannelFailure};

/** What a step run may add to the script's own text. */
export interface StepOptions {
  /** Cancels the run; the channel reports it as `cancelled`. */
  cancellation: AbortSignal;
  /** What the script reads on its standard input; nothing when absent. */
  input?: ScriptInput;
  /** Receives every output line as it arrives, before the outcome is known. */
  onLine?: (line: string) => void;
}

/** The interpreter a host needs, from what its channel knows of it. */
function interpreterOf(channel: HostChannel): Interpreter {
  return channel.platformHint() === 'windows' ? 'powershell' : 'posixShell';
}

/**
 * Runs the script of `request` and reads its result block. A channel failure is a value; a script that printed no
 * complete block is `noResultBlock`, which the caller treats as a closed channel.
 */
export async function runStep(
  channel: HostChannel,
  request: BootstrapRequest,
  parameters: ScriptParameters,
  options: StepOptions,
): Promise<StepRun> {
  const interpreter = interpreterOf(channel);
  const lines: string[] = [];
  const outcome = await channel.runScript(
    {
      script: scriptFor(request, interpreter, parameters),
      interpreter,
      environment: {},
      input: options.input ?? {kind: 'text', text: ''},
      cancellation: options.cancellation,
    },
    line => {
      lines.push(line);
      options.onLine?.(line);
    },
  );
  if (outcome.kind === 'failed') {
    return {kind: 'channelFailed', failure: outcome.failure};
  }
  const parsed = parseResult(lines);
  return 'block' in parsed
    ? {kind: 'result', block: parsed.block, exitStatus: outcome.status}
    : {kind: 'noResultBlock', exitStatus: outcome.status};
}
