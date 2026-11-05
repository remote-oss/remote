/**
 * @fileoverview The arguments of the `kubectl exec` that carries a pod window's channel: the context and the namespace
 * pinned in the payload, the pod and the container it names, and the command run in the container. Every member was
 * checked by `k8sTargetOf`; the two that could look like an option are passed in the `--name=value` form besides.
 */

import type {Dialer} from 'lib-forwarding';
import {preludeCommand} from 'lib-host';
import type {EngineHost} from '../engine/engine-host.ts';
import type {ExecCommands} from '../exec/exec-channel.ts';
import {execDialerOver} from '../exec/exec-dialer.ts';
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

/** The commands of the channel of the pod's container: its environment travels in the script, and a lost pod is no inspect away. */
export function k8sExecCommands(target: K8sTarget): ExecCommands {
  return {
    identity: `${target.namespace}/${target.podname}/${target.name}`,
    script: (names, count) =>
      kubectlExecArguments(target, ['sh', '-c', preludeCommand(count)]),
    copy: directory =>
      kubectlExecArguments(target, ['tar', '-x', '-f', '-', '-C', directory]),
    environment: 'script',
    stopped: () => Promise.resolve(undefined),
  };
}

/** The dialer that runs the relay script with the installed server's `node` in the pod's container. */
export function k8sDialer(
  engine: EngineHost,
  target: K8sTarget,
  nodePath: string,
  relayScriptPath: string,
): Dialer {
  return execDialerOver(engine, port =>
    kubectlExecArguments(target, [nodePath, relayScriptPath, String(port)]),
  );
}
