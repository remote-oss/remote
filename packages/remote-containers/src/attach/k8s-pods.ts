/**
 * @fileoverview The pods of a `kubectl get -o json` answer: each with its namespace and its regular containers in the
 * order of the pod's spec, and the pods ordered by name.
 */

import {LABEL_COLLATOR} from '../explorer/targets-model.ts';

/** A container of a pod, with the image reference its spec names. */
export interface K8sContainer {
  name: string;
  image: string;
}

/** A pod as the pickers show it. */
export interface K8sPod {
  name: string;
  namespace: string;
  /** The `spec.containers` entries, never the init containers, in spec order. */
  containers: readonly K8sContainer[];
}

/** The text member `key` of `value` when it is a string. */
function textOf(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const member = (value as Record<string, unknown>)[key];
  return typeof member === 'string' && member !== '' ? member : undefined;
}

/** The pod `item` describes, or none when it has no name. */
function podOf(item: unknown): K8sPod | undefined {
  const record = typeof item === 'object' && item !== null ? item : {};
  const metadata = (record as Record<string, unknown>).metadata;
  const spec = (record as Record<string, unknown>).spec;
  const name = textOf(metadata, 'name');
  if (name === undefined) {
    return undefined;
  }
  const listed =
    typeof spec === 'object' && spec !== null
      ? (spec as Record<string, unknown>).containers
      : undefined;
  const containers: K8sContainer[] = [];
  for (const each of Array.isArray(listed) ? (listed as unknown[]) : []) {
    const containerName = textOf(each, 'name');
    if (containerName !== undefined) {
      containers.push({
        name: containerName,
        image: textOf(each, 'image') ?? '',
      });
    }
  }
  return {
    name,
    namespace: textOf(metadata, 'namespace') ?? '',
    containers,
  };
}

/**
 * The pods `text` holds, ordered by name: a list answer's items, or the one pod of an answer for a single pod. None
 * when `text` is not JSON or holds neither.
 */
export function podsOf(text: string): K8sPod[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const items =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).items
      : undefined;
  const found = Array.isArray(items)
    ? (items as unknown[])
    : textOf(parsed, 'kind') === 'Pod'
      ? [parsed]
      : undefined;
  if (found === undefined) {
    return undefined;
  }
  return found
    .map(podOf)
    .filter((pod): pod is K8sPod => pod !== undefined)
    .sort((left, right) => LABEL_COLLATOR.compare(left.name, right.name));
}

/** A Kubernetes object name: a DNS subdomain of lowercase letters, digits, `-` and `.`, that starts and ends with a letter or digit. */
const OBJECT_NAME = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;

/** A namespace name: a DNS label. */
const NAMESPACE_NAME = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * The pod a Kubernetes explorer row names: its `name`, and its `namespace` when it gives one, here or in `metadata`.
 * The row is the partner extension's, so a name or namespace that is not a valid Kubernetes name is no pod at all.
 */
export function podArgumentOf(
  argument: unknown,
): {name: string; namespace: string | undefined} | undefined {
  const metadata =
    typeof argument === 'object' && argument !== null
      ? (argument as Record<string, unknown>).metadata
      : undefined;
  const name = textOf(argument, 'name') ?? textOf(metadata, 'name');
  const namespace =
    textOf(argument, 'namespace') ?? textOf(metadata, 'namespace');
  if (
    name === undefined ||
    !OBJECT_NAME.test(name) ||
    (namespace !== undefined && !NAMESPACE_NAME.test(namespace))
  ) {
    return undefined;
  }
  return {name, namespace};
}
