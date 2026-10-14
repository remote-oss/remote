/**
 * @fileoverview An engine whose every call runs in a Docker context: the context goes to the `docker` process in its
 * own environment and never in an argument, so a container never sees it.
 */

import type {EngineHost} from '../engine/engine-host.ts';

/** The engine whose calls have `DOCKER_CONTEXT` set to `name`, in front of the environment the caller gives. */
export function withContext(engine: EngineHost, name: string): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options) =>
      engine.run(argv, input, {
        ...options,
        environment: {DOCKER_CONTEXT: name, ...options.environment},
      }),
    spawn: (argv, options) =>
      engine.spawn(argv, {
        ...options,
        environment: {DOCKER_CONTEXT: name, ...options.environment},
      }),
  };
}
