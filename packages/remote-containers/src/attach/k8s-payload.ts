/**
 * @fileoverview The payload of a `k8s-container` authority: the lowercase hex of a JSON text that names the kube context,
 * the pod with its namespace, the container and the image its label shows; its reading back; and the check that every
 * member is a name `kubectl` may be given. A link can name the authority, so no member reaches `kubectl` unchecked.
 */

import {payloadRecordOf} from '../authority/payload.ts';

/** A pod's container: where it runs and what its label shows. Pinned: a reload uses it whatever the kubeconfig says. */
export interface K8sTarget {
  /** The kube context. */
  context: string;
  /** The pod's name. */
  podname: string;
  namespace: string;
  /** The container's name. */
  name: string;
  /** The image reference the label shows. */
  image: string;
}

/** A payload that is not a target, and the step that refused it; a member that fails the name rules is named. */
export type K8sMalformed =
  | {malformed: 'hex' | 'json' | 'shape'}
  | {malformed: 'invalid'; member: keyof K8sTarget};

/** The members in the order the payload writes them. */
const MEMBERS: ReadonlyArray<keyof K8sTarget> = [
  'context',
  'podname',
  'namespace',
  'name',
  'image',
];

const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const DNS_SUBDOMAIN_PART = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
const MAX_SUBDOMAIN = 253;
// eslint-disable-next-line no-control-regex -- the rule is about the control characters themselves
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Whether `value` is a DNS-1123 subdomain: dot-separated labels of lowercase letters, digits and `-`, at most 253 long. */
function isSubdomain(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SUBDOMAIN &&
    value.split('.').every(part => DNS_SUBDOMAIN_PART.test(part))
  );
}

/** The first member of `target` that is not a name `kubectl` may be given, or none. */
export function invalidMemberOf(
  target: K8sTarget,
): keyof K8sTarget | undefined {
  if (
    target.context === '' ||
    target.context.startsWith('-') ||
    CONTROL.test(target.context)
  ) {
    return 'context';
  }
  if (!isSubdomain(target.podname)) {
    return 'podname';
  }
  if (!DNS_LABEL.test(target.namespace)) {
    return 'namespace';
  }
  if (!DNS_LABEL.test(target.name)) {
    return 'name';
  }
  return target.image === '' || CONTROL.test(target.image)
    ? 'image'
    : undefined;
}

/** The payload of a target: its JSON text, members in a fixed order, as lowercase hex. */
export function k8sPayloadOf(target: K8sTarget): string {
  const text = JSON.stringify(
    Object.fromEntries(MEMBERS.map(member => [member, target[member]])),
  );
  return Buffer.from(text, 'utf8').toString('hex');
}

/** Reads a payload: the target it names, or why it is none. A target with a member that fails the name rules is refused. */
export function k8sTargetOf(payload: string): K8sTarget | K8sMalformed {
  const read = payloadRecordOf(payload);
  if ('malformed' in read) {
    return read;
  }
  const values = MEMBERS.map(member => read.record?.[member]);
  if (!values.every(value => typeof value === 'string')) {
    return {malformed: 'shape'};
  }
  const [context, podname, namespace, name, image] = values as [
    string,
    string,
    string,
    string,
    string,
  ];
  const target: K8sTarget = {context, podname, namespace, name, image};
  const invalid = invalidMemberOf(target);
  return invalid === undefined
    ? target
    : {malformed: 'invalid', member: invalid};
}
