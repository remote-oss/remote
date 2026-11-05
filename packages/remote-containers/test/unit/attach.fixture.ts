import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';

/** `docker inspect`'s JSON for the container `containerId` named `name` in `state`. */
export function inspectedJson(
  name: string,
  containerId: string,
  state = 'running',
): string {
  return JSON.stringify([
    {
      // eslint-disable-next-line id-length -- the engine's own member is named Id
      Id: containerId,
      Name: `/${name}`,
      Created: '2026-11-03T10:00:00Z',
      Config: {Image: 'alpine:latest'},
      State: {Status: state},
    },
  ]);
}

/** A run that ended with `status` and printed `stdout`. */
export function exits(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}
