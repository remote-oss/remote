/**
 * @fileoverview The default forwards of the setting: which entries become tunnel requests, which are skipped and why,
 * and the reading of a port number.
 */

/** A port to forward from the host's loopback, with the port to listen on here. */
export interface TunnelRequest {
  remoteHost: string;
  remotePort: number;
  localPort: number;
  label?: string;
}

/** Why an entry of the setting was skipped. */
export type SkipReason =
  | 'notAnObject'
  | 'missingRemotePort'
  | 'invalidRemotePort'
  | 'duplicateRemotePort';

/** An entry that was skipped, by its position in the setting. */
export interface SkippedEntry {
  index: number;
  reason: SkipReason;
}

/** What the setting asks for; `settingProblem` is set when the value is not a list. */
export interface DefaultForwards {
  requests: TunnelRequest[];
  skipped: SkippedEntry[];
  settingProblem?: 'notAnArray';
}

const PORT_MINIMUM = 1;
const PORT_MAXIMUM = 65535;

/** The value when it is a whole number from 1 to 65535. */
function portOfNumber(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PORT_MINIMUM &&
    value <= PORT_MAXIMUM
    ? value
    : undefined;
}

/** The port a text of ASCII digits reads to, when it is from 1 to 65535. */
export function portOfText(text: string): number | undefined {
  return /^\d+$/.test(text) ? portOfNumber(Number(text)) : undefined;
}

function portOfEntry(value: unknown): number | undefined {
  return typeof value === 'string' ? portOfText(value) : portOfNumber(value);
}

function requestOf(
  entry: unknown,
  taken: ReadonlySet<number>,
): TunnelRequest | SkipReason {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return 'notAnObject';
  }
  const given: unknown = Reflect.get(entry, 'remotePort');
  if (given === undefined) {
    return 'missingRemotePort';
  }
  const remotePort = portOfEntry(given);
  if (remotePort === undefined) {
    return 'invalidRemotePort';
  }
  if (taken.has(remotePort)) {
    return 'duplicateRemotePort';
  }
  const name: unknown = Reflect.get(entry, 'name');
  return {
    remoteHost: 'localhost',
    remotePort,
    localPort: portOfNumber(Reflect.get(entry, 'localPort')) ?? remotePort,
    ...(typeof name === 'string' && name !== '' ? {label: name} : {}),
  };
}

/** Reads the setting's value: the entries that make requests, in order, and the ones skipped with their reason. */
export function parseDefaultForwards(settingValue: unknown): DefaultForwards {
  if (settingValue === undefined) {
    return {requests: [], skipped: []};
  }
  if (!Array.isArray(settingValue)) {
    return {requests: [], skipped: [], settingProblem: 'notAnArray'};
  }
  const entries: unknown[] = settingValue;
  const requests: TunnelRequest[] = [];
  const skipped: SkippedEntry[] = [];
  const taken = new Set<number>();
  for (const [index, entry] of entries.entries()) {
    const outcome = requestOf(entry, taken);
    if (typeof outcome === 'string') {
      skipped.push({index, reason: outcome});
    } else {
      taken.add(outcome.remotePort);
      requests.push(outcome);
    }
  }
  return {requests, skipped};
}
