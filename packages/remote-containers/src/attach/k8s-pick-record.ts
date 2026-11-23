/**
 * @fileoverview The pods the user picked: the Kubernetes attach records a target in the profile's set of picks before it
 * opens its window, and the registration of the pod family connects to a target that is not recorded only after the
 * attach warning is confirmed.
 */

import type {K8sTarget} from './k8s-payload.ts';

/** The name of a picked pod container: its context, namespace, pod and container; the image is only the label's. */
export function k8sPickKeyOf(target: K8sTarget): string {
  return JSON.stringify([
    target.context,
    target.namespace,
    target.podname,
    target.name,
  ]);
}
