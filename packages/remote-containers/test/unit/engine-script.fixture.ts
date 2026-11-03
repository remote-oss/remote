import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import type {EngineStepPorts} from '../../src/volumes/engine-step.ts';

/** An engine reply that exited with `status`. */
export function exited(
  status: number,
  stdout = '',
  stderr = '',
): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr};
}

/** How a scripted engine answers a call by its short form: undefined for a plain success. */
export type EngineScript = (short: string) => EngineRunOutcome | undefined;

/**
 * An engine that names each call by `shortOf`, records the names in order, and answers by `script`, or with exit 0
 * and `stdoutOf`'s text.
 */
export function scriptedEngine(
  shortOf: (argv: readonly string[]) => string,
  script: EngineScript,
  stdoutOf: (short: string) => string = () => '',
): EngineStepPorts & {calls: string[]} {
  const calls: string[] = [];
  return {
    calls,
    engine: {
      // eslint-disable-next-line id-length -- the port's method is named run
      run: argv => {
        const short = shortOf(argv);
        calls.push(short);
        return Promise.resolve(script(short) ?? exited(0, stdoutOf(short)));
      },
    },
    options: {cancellation: new AbortController().signal},
  };
}
