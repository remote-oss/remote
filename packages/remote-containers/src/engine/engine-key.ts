/**
 * @fileoverview The key of the effective engine of a local window, read now: what the engine settings and the
 * editor's environment say, else the current Docker context and its endpoint, as the CLI answers them.
 */

import {
  engineEnvironment,
  engineKeyOf,
  type EngineSources,
} from './effective-engine.ts';
import {engineBaseOf, type WindowFolder} from './executable.ts';
import {
  contextEndpoint,
  contextState,
  type PreflightDependencies,
} from './preflight.ts';

/** The current context of the engine, and the endpoint it points to when it has one. */
async function ambientContextOf(
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<
  | {kind: 'unreadable'}
  | {kind: 'noContexts'}
  | {kind: 'context'; name: string; endpoint: string | undefined}
> {
  const state = await contextState(dependencies, base, cancellation);
  if (state.kind !== 'context') {
    return state;
  }
  return {
    kind: 'context',
    name: state.name,
    endpoint: await contextEndpoint(
      dependencies,
      base,
      state.name,
      cancellation,
    ),
  };
}

/**
 * The key of the effective engine now; undefined when the CLI gave nothing usable, so that the last key stays. A
 * relative `dev.containers.dockerPath` is the window's folder's own file, which runs only once the folder is trusted.
 */
export async function effectiveEngineKey(
  sources: EngineSources,
  dependencies: PreflightDependencies,
  window: WindowFolder,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  const base = engineBaseOf(window);
  const environment = engineEnvironment(sources);
  if (
    environment.DOCKER_HOST !== undefined ||
    environment.DOCKER_CONTEXT !== undefined
  ) {
    return engineKeyOf(environment, 'noContexts');
  }
  const ambient = await ambientContextOf(dependencies, base, cancellation);
  if (ambient.kind === 'unreadable') {
    return undefined;
  }
  if (ambient.kind === 'noContexts') {
    return engineKeyOf(environment, 'noContexts');
  }
  return ambient.endpoint === undefined
    ? undefined
    : engineKeyOf(environment, {
        context:
          ambient.name === '' || ambient.name === 'default'
            ? undefined
            : ambient.name,
        endpoint: ambient.endpoint,
      });
}

/**
 * The address the Docker CLI talks to: the `DOCKER_HOST` of the engine environment, else the endpoint of the
 * `DOCKER_CONTEXT`, else that of the current context; undefined when none can be read. `docker context inspect` reads the
 * local context store and reaches no engine.
 */
export async function endpointInEffect(
  sources: EngineSources,
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  const environment = engineEnvironment(sources);
  if (environment.DOCKER_HOST !== undefined) {
    return environment.DOCKER_HOST;
  }
  if (environment.DOCKER_CONTEXT !== undefined) {
    return contextEndpoint(
      dependencies,
      base,
      environment.DOCKER_CONTEXT,
      cancellation,
    );
  }
  const ambient = await ambientContextOf(dependencies, base, cancellation);
  return ambient.kind === 'context' ? ambient.endpoint : undefined;
}
