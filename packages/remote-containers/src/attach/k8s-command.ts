/**
 * @fileoverview Attach to Running Kubernetes Container: the warning, the listing of the pods that fills a picker which
 * is open and busy from the start, the pick of a container, and the selection handed on. A second invocation while one
 * is pending shows the same picker.
 */

import type {Logger} from 'lib-log';
import type {
  ContextAnswer,
  PodListing,
  PodRequest,
} from '../engine/kubectl-host.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {type K8sContainer, type K8sPod, podArgumentOf} from './k8s-pods.ts';

/** The English templates of the dialogs and pickers this command shows. */
const K8S_TEMPLATES = {
  S173: 'Error while attaching to Kubernetes container.',
  S241: 'No pods found.',
  S314: 'Select pod',
  S312: 'Select container',
  S064: 'Choose Container',
  confirm: 'OK',
  cancel: 'Cancel',
  showLog: 'Show Log',
} as const;

/** What the user picked: the kubeconfig's context at that time, the pod with its namespace, and one of its containers. */
export interface K8sSelection {
  context: string;
  namespace: string;
  pod: string;
  container: K8sContainer;
}

/** One entry of a picker: how it shows, and what it stands for. */
export interface K8sPickItem<Value> {
  label: string;
  description: string;
  value: Value;
}

/** A picker while it is open. */
export interface K8sPicker<Value> {
  /** Fills the picker with its items and stops its busy state. */
  fill: (items: ReadonlyArray<K8sPickItem<Value>>) => void;
  /** The value the user picked; none when the picker was dismissed. */
  chosen: Promise<Value | undefined>;
  /** Brings the picker to the front again. */
  reveal: () => void;
  close: () => void;
}

/** Everything the command needs of the editor and the machine. */
export interface K8sAttachPorts {
  /** The attach family's warning; whether the command goes on. */
  warning(): Promise<boolean>;
  listPods(
    request: PodRequest | undefined,
    cancellation: AbortSignal,
  ): Promise<PodListing>;
  currentContext(cancellation: AbortSignal): Promise<ContextAnswer>;
  /** Opens a picker with `placeholder`, empty and busy. */
  openPicker<Value>(placeholder: string): K8sPicker<Value>;
  /** Shows a modal error with a detail and one button. */
  showError(
    message: string,
    detail: string,
    button: string,
  ): PromiseLike<unknown>;
  /** Shows a modal information with a detail and buttons; the one chosen, none for Cancel or Escape. */
  showInformation(
    detail: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  /** Reveals the log. */
  revealLog(): void;
  /** Takes the selection on to the attach. */
  attach(selection: K8sSelection): Promise<void>;
  translate: Translate;
  logger: Logger;
}

/** The commands over `ports`. */
export function k8sAttachCommandsOf(ports: K8sAttachPorts): {
  /** The Command Palette's route: the pods of the current namespace. */
  fromPalette(): Promise<void>;
  /** The Kubernetes explorer's route: the pod of the row, or the palette's route when the row names none. */
  fromViewlet(argument: unknown): Promise<void>;
} {
  const {translate, logger} = ports;
  let pending: {done: Promise<void>; reveal: () => void} | undefined;

  /** The failure of the listing: the error, then the log. */
  async function listingFailed(detail: string): Promise<void> {
    logger.warn(`the pods could not be listed: ${detail}`);
    await ports.showError(
      translate(K8S_TEMPLATES.S173),
      detail,
      translate(K8S_TEMPLATES.confirm),
    );
    ports.revealLog();
  }

  /** The container of `pod` the user means: the only one, or the pick of one. */
  async function containerOf(
    pod: K8sPod,
    placeholder: string,
  ): Promise<K8sContainer | undefined> {
    const [only, ...others] = pod.containers;
    if (only === undefined) {
      logger.warn(`the pod ${pod.name} lists no container`);
      return undefined;
    }
    if (others.length === 0) {
      return only;
    }
    const picker = ports.openPicker<K8sContainer>(placeholder);
    picker.fill(
      pod.containers.map(container => ({
        label: container.name,
        description: container.image,
        value: container,
      })),
    );
    return picker.chosen;
  }

  /** Hands on the pod's container the user picks, with the context of that moment. */
  async function selected(
    pod: K8sPod,
    placeholder: string,
    cancellation: AbortSignal,
  ): Promise<void> {
    const container = await containerOf(pod, placeholder);
    if (container === undefined) {
      return;
    }
    const context = await ports.currentContext(cancellation);
    if (context.kind === 'failed') {
      await listingFailed(context.detail);
      return;
    }
    await ports.attach({
      context: context.name,
      namespace: pod.namespace,
      pod: pod.name,
      container,
    });
  }

  /** The Command Palette's route, with the warning accepted. */
  async function pickPod(record: {reveal: () => void}): Promise<void> {
    const picker = ports.openPicker<K8sPod>(translate(K8S_TEMPLATES.S314));
    record.reveal = () => {
      picker.reveal();
    };
    const listing = new AbortController();
    void picker.chosen.then(pod => {
      if (pod === undefined) {
        listing.abort();
      }
    });
    const listed = await ports.listPods(undefined, listing.signal);
    if (listed.kind === 'cancelled') {
      return;
    }
    if (listed.kind === 'failed') {
      picker.close();
      await listingFailed(listed.detail);
      return;
    }
    if (listed.pods.length === 0) {
      picker.close();
      logger.info('the current namespace has no pods');
      const answer = await ports.showInformation(
        translate(K8S_TEMPLATES.S241),
        [translate(K8S_TEMPLATES.cancel), translate(K8S_TEMPLATES.showLog)],
      );
      if (answer === translate(K8S_TEMPLATES.showLog)) {
        ports.revealLog();
      }
      return;
    }
    picker.fill(
      listed.pods.map(pod => ({
        label: pod.name,
        description: pod.namespace,
        value: pod,
      })),
    );
    const pod = await picker.chosen;
    if (pod !== undefined) {
      await selected(pod, translate(K8S_TEMPLATES.S312), listing.signal);
    }
  }

  /** The Kubernetes explorer's route for a pod that is known by name. */
  async function viewletPod(request: PodRequest): Promise<void> {
    const listing = new AbortController();
    const listed = await ports.listPods(request, listing.signal);
    if (listed.kind === 'failed') {
      await listingFailed(listed.detail);
      return;
    }
    const pod = listed.kind === 'listed' ? listed.pods[0] : undefined;
    if (pod !== undefined) {
      await selected(pod, translate(K8S_TEMPLATES.S064), listing.signal);
    }
  }

  /** Runs `route` once the warning is accepted, unless another run is pending, which is shown instead. */
  function singly(
    route: (record: {reveal: () => void}) => Promise<void>,
  ): Promise<void> {
    if (pending !== undefined) {
      pending.reveal();
      return pending.done;
    }
    const record = {
      reveal: () => undefined,
      done: Promise.resolve(),
    };
    pending = record;
    record.done = (async () => {
      try {
        if (await ports.warning()) {
          await route(record);
        }
      } finally {
        pending = undefined;
      }
    })();
    return record.done;
  }

  return {
    fromPalette: () => singly(pickPod),
    fromViewlet: argument => {
      const request = podArgumentOf(argument);
      return singly(
        request === undefined ? pickPod : () => viewletPod(request),
      );
    },
  };
}
