/**
 * @fileoverview The window of a picked pod container: the pick is recorded in the profile, the window's label is
 * registered, and a new window opens on the `k8s-container` authority that names the target.
 */

import {
  type DecodedTarget,
  encodeAuthority,
  type OpenOutcome,
} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {K8sSelection} from './k8s-command.ts';
import {k8sLabelOf} from './k8s-label.ts';
import {k8sPayloadOf, type K8sTarget} from './k8s-payload.ts';
import {k8sPickKeyOf} from './k8s-pick-record.ts';

/** What opening the window needs of the editor and the profile. */
export interface K8sWindowPorts {
  registerLabel(decoded: DecodedTarget, suffix: string): void;
  /** Records the target named `key` as picked, before its window opens. */
  recordPick(key: string): Promise<void>;
  /** Opens a new window, with no folder, on the authority. */
  openWindow(authority: string): Promise<OpenOutcome>;
  translate: Translate;
  logger: Logger;
}

/** The handler that opens the window of the container the user picked. */
export function k8sWindowOpenerOf(
  ports: K8sWindowPorts,
): (selection: K8sSelection) => Promise<void> {
  return async selection => {
    const target: K8sTarget = {
      context: selection.context,
      podname: selection.podName,
      namespace: selection.namespace,
      name: selection.container.name,
      image: selection.container.image,
    };
    const payload = k8sPayloadOf(target);
    const decoded: DecodedTarget = {
      family: 'k8s-container',
      target: {payload},
      rawHostString: payload,
    };
    ports.registerLabel(decoded, k8sLabelOf(target, ports.translate));
    await ports.recordPick(k8sPickKeyOf(target));
    const opened = await ports.openWindow(encodeAuthority(decoded));
    if (opened.kind === 'rejected') {
      ports.logger.warn(
        `Attach to Running Kubernetes Container was refused: ${opened.reason}`,
      );
    }
  };
}
