/**
 * @fileoverview How a helper process is started: the bundled script on the editor's own runtime, detached, without
 * a console window or standard streams, its parameters in one environment variable and never on the command line.
 */

import type {EndPolicy} from '../types.ts';

/** The environment variable that carries a helper's parameters as JSON. */
export const PARAMETERS_VARIABLE = 'REMOTE_OSS_HELPER_PARAMETERS';

/** What a helper needs to serve, handed over at its start. */
export interface HelperParameters {
  endpoint: string;
  nonce: string;
  /** The helper's registry record, which it removes when it ends. */
  recordFile: string;
  policy: EndPolicy;
  payload: Record<string, string | number | boolean>;
  /** The consumer's own start values. */
  options: Record<string, string | number | boolean>;
}

/** The program, its arguments and the process options a helper is started with. */
export interface SpawnSpecification {
  command: string;
  commandArguments: string[];
  detached: true;
  stdio: 'ignore';
  windowsHide: true;
  environment: Record<string, string>;
}

/** Starts a process by its specification; rejects when the process cannot start. */
export type Spawner = (specification: SpawnSpecification) => Promise<void>;

/**
 * The specification of a helper: `runtime` is the editor's executable, which runs the script as Node.js when
 * ELECTRON_RUN_AS_NODE is set; the parent's environment is kept, so the helper runs as the same user.
 */
export function spawnSpecification(
  runtime: string,
  script: string,
  parameters: HelperParameters,
  parentEnvironment: Readonly<Record<string, string | undefined>>,
): SpawnSpecification {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(parentEnvironment)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  environment.ELECTRON_RUN_AS_NODE = '1';
  environment[PARAMETERS_VARIABLE] = JSON.stringify(parameters);
  return {
    command: runtime,
    commandArguments: [script],
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    environment,
  };
}
