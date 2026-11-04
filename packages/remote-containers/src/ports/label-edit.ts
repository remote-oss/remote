/**
 * @fileoverview The edit of "Set Label and Update devcontainer.json": the label of a port written to the entry that
 * the port's own number keys in `portsAttributes`, with the keys in the order a user reads them. Everything outside
 * the value of `portsAttributes` stays as it was.
 */

import {parse, parseTree} from 'jsonc-parser';
import {NotAnObjectError, setProperty} from '../config/jsonc-edit.ts';

/** `portsAttributes` is there as something other than an object. */
export class PortsAttributesNotAnObjectError extends Error {
  /** An error that says the member is no object. */
  constructor() {
    super('portsAttributes is not an object');
    this.name = 'PortsAttributesNotAnObjectError';
  }
}

/** Whether a key is only digits, as a port number is. */
function numberLike(key: string): boolean {
  return /^\d+$/.test(key);
}

/** An object's own entries; a value that is no object has none. */
function entriesOf(value: unknown): Array<[string, unknown]> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

/**
 * The text with `label` as the label of the entry keyed by `port`, which is created when missing; a range or a
 * `host:port` key that covers the port is left as it is. The keys that are numbers come first, ascending, then the
 * others in their order. None when the entry holds that label already. Throws `NotAnObjectError` for text that is no
 * object, and `PortsAttributesNotAnObjectError` for a `portsAttributes` that is no object.
 */
export function labelEdit(
  text: string,
  port: number,
  label: string,
): string | undefined {
  if (parseTree(text, [])?.type !== 'object') {
    throw new NotAnObjectError();
  }
  const root = parse(text) as Record<string, unknown>;
  const declared = root.portsAttributes;
  if (
    declared !== undefined &&
    (typeof declared !== 'object' ||
      declared === null ||
      Array.isArray(declared))
  ) {
    throw new PortsAttributesNotAnObjectError();
  }
  const key = String(port);
  const present = entriesOf(declared);
  const own = present.find(([name]) => name === key)?.[1];
  if (
    typeof own === 'object' &&
    own !== null &&
    (own as Record<string, unknown>).label === label
  ) {
    return undefined;
  }
  const entry = {
    ...(entriesOf(own).length > 0 ? Object.fromEntries(entriesOf(own)) : {}),
    label,
  };
  const merged = [
    ...present.filter(([name]) => name !== key),
    [key, entry] as [string, unknown],
  ];
  const ordered = [
    ...merged
      .filter(([name]) => numberLike(name))
      .sort(([left], [right]) => Number(left) - Number(right)),
    ...merged.filter(([name]) => !numberLike(name)),
  ];
  return setProperty(text, ['portsAttributes'], Object.fromEntries(ordered));
}
