/**
 * @fileoverview The arguments of the `kubectl exec` that carries a pod window's channel: the context and the namespace
 * pinned in the payload, the pod and the container it names, and the command run in the container. Every member was
 * checked by `k8sTargetOf`; the two that could look like an option are passed in the `--name=value` form besides.
 */

import type {K8sTarget} from './k8s-payload.ts';

/** `kubectl exec -i` for `target` running `command` in its container, with no terminal. */
export function kubectlExecArguments(
  target: K8sTarget,
  command: readonly string[],
): string[] {
  return [
    'exec',
    '-i',
    `--context=${target.context}`,
    `--namespace=${target.namespace}`,
    target.podname,
    `--container=${target.name}`,
    '--',
    ...command,
  ];
}
