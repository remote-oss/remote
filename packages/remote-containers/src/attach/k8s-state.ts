/**
 * @fileoverview The state of a pod window's container as `kubectl get pod -o json` reports it, in the shape a held
 * connection compares between one resolve and the next: running since a time, not running, or gone.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import {recordOf} from '../json-record.ts';
import type {K8sTarget} from './k8s-payload.ts';

/** The container's state, that the pod is gone, or that the cluster could not be asked. */
export type PodState =
  {status: string; startedAt: string} | 'missing' | 'unreachable';

/** The arguments that read the pod of `target`. */
export function podGetArguments(target: K8sTarget): string[] {
  return [
    'get',
    'pod',
    target.podname,
    `--context=${target.context}`,
    `--namespace=${target.namespace}`,
    '-o',
    'json',
  ];
}

/** The state of the container `name` in the pod that `stdout` describes; none when the text is no pod. */
export function containerStateOf(
  stdout: string,
  name: string,
): PodState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const statuses = recordOf(recordOf(parsed)?.status)?.containerStatuses;
  if (!Array.isArray(statuses)) {
    return {status: 'created', startedAt: ''};
  }
  const own = (statuses as unknown[])
    .map(recordOf)
    .find(status => status?.name === name);
  const state = recordOf(own?.state);
  const running = recordOf(state?.running);
  if (running !== undefined) {
    return {
      status: 'running',
      startedAt: typeof running.startedAt === 'string' ? running.startedAt : '',
    };
  }
  const terminated = recordOf(state?.terminated);
  if (terminated !== undefined) {
    return {
      status: 'exited',
      startedAt:
        typeof terminated.startedAt === 'string' ? terminated.startedAt : '',
    };
  }
  return {status: 'created', startedAt: ''};
}

/** The state of the container of `target`, read with `kubectl`. */
export async function inspectedPod(
  engine: EngineHost,
  target: K8sTarget,
  cancellation: AbortSignal,
): Promise<PodState> {
  const outcome = await engine.run(
    podGetArguments(target),
    {kind: 'none'},
    {cancellation},
  );
  if (outcome.kind !== 'ran') {
    return 'unreachable';
  }
  if (outcome.status !== 0) {
    return /\bNotFound\b|\bnot found\b/.test(outcome.stderr)
      ? 'missing'
      : 'unreachable';
  }
  return containerStateOf(outcome.stdout, target.name) ?? 'unreachable';
}
