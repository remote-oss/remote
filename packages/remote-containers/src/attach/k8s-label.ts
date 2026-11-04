/**
 * @fileoverview The text a pod window shows after its folder: the container's name, the pod's name and the image
 * reference. The namespace is not shown.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {K8sTarget} from './k8s-payload.ts';

/** The English template of the label. */
const K8S_LABEL_TEMPLATE = '{0} in {1} ({2})';

/** The label of the window attached to `target`. */
export function k8sLabelOf(target: K8sTarget, translate: Translate): string {
  return filled(translate, K8S_LABEL_TEMPLATE, [
    target.name,
    target.podname,
    target.image,
  ]);
}
