/**
 * @fileoverview The key of the effective engine of a local window, read now: what the engine settings and the
 * editor's environment say, else the current Docker context and its endpoint, as the CLI answers them.
 */

import {
  engineEnvironment,
  engineKeyOf,
  type EngineSources,
} from './effective-engine.ts';
import {
  contextEndpoint,
  contextState,
  type PreflightDependencies,
} from './preflight.ts';

/** The key of the effective engine now; undefined when the CLI gave nothing usable, so that the last key stays. */
export async function effectiveEngineKey(
  sources: EngineSources,
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  const environment = engineEnvironment(sources);
  if (
    environment.DOCKER_HOST !== undefined ||
    environment.DOCKER_CONTEXT !== undefined
  ) {
    return engineKeyOf(environment, 'noContexts');
  }
  const state = await contextState(dependencies, base, cancellation);
  if (state.kind === 'unreadable') {
    return undefined;
  }
  if (state.kind === 'noContexts') {
    return engineKeyOf(environment, 'noContexts');
  }
  const endpoint = await contextEndpoint(
    dependencies,
    base,
    state.name,
    cancellation,
  );
  return endpoint === undefined
    ? undefined
    : engineKeyOf(environment, {
        context:
          state.name === '' || state.name === 'default'
            ? undefined
            : state.name,
        endpoint,
      });
}
