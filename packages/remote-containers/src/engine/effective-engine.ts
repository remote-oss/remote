/**
 * @fileoverview The effective engine: the one place that turns the engine settings, the editor's environment and the
 * current Docker context into the variables that pick the engine a `docker` process talks to. Everything that spawns
 * `docker` is given the result and never reads the settings itself.
 */

import type {EngineHost} from './engine-host.ts';

/** The variables of the editor's or a setting's environment that pick an engine; every other variable is ignored. */
const ENGINE_VARIABLES = [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
] as const;

/** The variables that pick an engine, with their values. */
export type EngineEnvironment = Readonly<Record<string, string>>;

/** What the resolution reads: the five engine settings as the editor holds them, and the editor's environment. */
export interface EngineSources {
  containersEnvironment: unknown;
  dockerEnvironment: unknown;
  dockerHost: unknown;
  certPath: unknown;
  tlsVerify: unknown;
  processEnvironment: Readonly<Record<string, string | undefined>>;
}

/** The engine a connection is pinned to, as a payload holds it. */
export interface PinnedEngine {
  context?: string;
  host?: string;
  certPath?: string;
  tlsVerify?: string;
}

const PINNED_KEYS: ReadonlyArray<[keyof PinnedEngine, string]> = [
  ['context', 'DOCKER_CONTEXT'],
  ['host', 'DOCKER_HOST'],
  ['certPath', 'DOCKER_CERT_PATH'],
  ['tlsVerify', 'DOCKER_TLS_VERIFY'],
];

/** The engine variables a record holds as non-empty text. */
function engineVariablesOf(
  record: unknown,
): Readonly<Record<string, string | undefined>> {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return {};
  }
  const found: Record<string, string | undefined> = {};
  for (const name of ENGINE_VARIABLES) {
    const value = (record as Record<string, unknown>)[name];
    if (typeof value === 'string' && value !== '') {
      found[name] = value;
    }
  }
  return found;
}

/**
 * The variables that pick the engine. Each comes from the first of `containers.environment`, `docker.environment`,
 * the `docker.host`, `docker.certPath` and `docker.tlsVerify` settings, and the editor's environment that holds it.
 * A host wins over a context whatever their sources, and a context brings its own certificates.
 */
export function engineEnvironment(sources: EngineSources): EngineEnvironment {
  const layers = [
    engineVariablesOf(sources.containersEnvironment),
    engineVariablesOf(sources.dockerEnvironment),
    engineVariablesOf({
      DOCKER_HOST: sources.dockerHost,
      DOCKER_CERT_PATH: sources.certPath,
      DOCKER_TLS_VERIFY: sources.tlsVerify,
    }),
    engineVariablesOf(sources.processEnvironment),
  ];
  const chosen: Record<string, string> = {};
  for (const name of ENGINE_VARIABLES) {
    const value = layers.map(layer => layer[name]).find(each => each);
    if (value !== undefined) {
      chosen[name] = value;
    }
  }
  if (chosen.DOCKER_HOST === undefined) {
    delete chosen.DOCKER_CERT_PATH;
    delete chosen.DOCKER_TLS_VERIFY;
  } else {
    delete chosen.DOCKER_CONTEXT;
  }
  return chosen;
}

/** `environment` with the current context as `DOCKER_CONTEXT` when it picks nothing else. */
export function withAmbientContext(
  environment: EngineEnvironment,
  ambientContext: string | undefined,
): EngineEnvironment {
  return ambientContext === undefined ||
    environment.DOCKER_HOST !== undefined ||
    environment.DOCKER_CONTEXT !== undefined
    ? environment
    : {...environment, DOCKER_CONTEXT: ambientContext};
}

/**
 * What names the effective engine of a local window, as one text that is equal exactly when the engine is the same.
 * A host or a context from a setting or the editor's environment names it alone, so `docker context use` changes
 * nothing; with none, it is the current context and its endpoint, or `noContexts` for an engine without contexts.
 */
export function engineKeyOf(
  environment: EngineEnvironment,
  ambient: {context: string | undefined; endpoint: string} | 'noContexts',
): string {
  if (
    environment.DOCKER_HOST !== undefined ||
    environment.DOCKER_CONTEXT !== undefined
  ) {
    return JSON.stringify(environment);
  }
  if (ambient === 'noContexts') {
    return 'noContexts';
  }
  return JSON.stringify({
    ...environment,
    context: ambient.context ?? 'default',
    endpoint: ambient.endpoint,
  });
}

/** The members of a payload for `environment`. */
export function pinnedEngineOf(environment: EngineEnvironment): PinnedEngine {
  const pinned: PinnedEngine = {};
  for (const [member, name] of PINNED_KEYS) {
    const value = environment[name];
    if (value !== undefined) {
      pinned[member] = value;
    }
  }
  return pinned;
}

/** The variables of a payload's engine. */
export function environmentOfPinned(pinned: PinnedEngine): EngineEnvironment {
  const environment: Record<string, string> = {};
  for (const [member, name] of PINNED_KEYS) {
    const value = pinned[member];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

/** What a window's title says of the engine: the host if one is pinned, else the context; none for the default. */
export function engineLabelOf(pinned: PinnedEngine): string | undefined {
  return pinned.host ?? pinned.context;
}

/** The engine whose every call has `environment` in front of the environment the caller gives. */
export function withEnvironment(
  engine: EngineHost,
  environment: () => EngineEnvironment,
): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options) =>
      engine.run(argv, input, {
        ...options,
        environment: {...environment(), ...options.environment},
      }),
    spawn: (argv, options) =>
      engine.spawn(argv, {
        ...options,
        environment: {...environment(), ...options.environment},
      }),
  };
}
