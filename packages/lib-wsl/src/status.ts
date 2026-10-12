/**
 * @fileoverview The report of `wsl.exe --status` once decoded: `Label: value` lines, of which the extension reads
 * the default distribution and version and the WSL and kernel versions.
 */

/** What the report says; a field the report does not give is left out. */
export interface WslStatus {
  readonly defaultDistro?: string;
  readonly defaultVersion?: 1 | 2;
  readonly wslVersion?: string;
  readonly kernelVersion?: string;
}

/** What each label gives, by the label in lower case. */
const FIELDS: ReadonlyMap<string, (value: string) => Partial<WslStatus>> =
  new Map<string, (value: string) => Partial<WslStatus>>([
    ['default distribution', value => ({defaultDistro: value})],
    [
      'default version',
      value =>
        value === '1' || value === '2'
          ? {defaultVersion: value === '1' ? 1 : 2}
          : {},
    ],
    ['wsl version', value => ({wslVersion: value})],
    ['kernel version', value => ({kernelVersion: value})],
  ]);

/** Reads the report; a line that is not a known label is ignored and the function never fails. */
export function parseStatus(text: string): WslStatus {
  const seen = new Set<string>();
  let status: WslStatus = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    const label = line.slice(0, colon).trim().toLowerCase();
    const reader = colon === -1 ? undefined : FIELDS.get(label);
    if (reader !== undefined && !seen.has(label)) {
      seen.add(label);
      const value = line.slice(colon + 1).trim();
      status = value === '' ? status : {...status, ...reader(value)};
    }
  }
  return status;
}
