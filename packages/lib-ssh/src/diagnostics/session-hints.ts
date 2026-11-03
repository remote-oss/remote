/**
 * @fileoverview What a session record keeps besides the errors: the environment hints, built from a snapshot of the
 * settings and the client, and the number each error hint's status gets.
 */

/** One setting as the record shows it: its name, the effective value, and the description the manifest gives it. */
export interface SettingSnapshot {
  /** The setting's name without the `remote.SSH.` prefix. */
  name: string;
  /** What `getConfiguration('remote.SSH').get(name)` gave; `undefined` when nothing is set or declared. */
  value: unknown;
  /** The manifest's description; none where BR-9 lists the setting without details. */
  description?: string;
}

/** What the environment hints are built from. */
export interface EnvironmentSnapshot {
  /** The settings in the order the record lists them. */
  settings: readonly SettingSnapshot[];
  editorVersion: string;
  extensionVersion: string;
  platform: string;
  architecture: string;
}

/** One environment hint. */
export interface EnvironmentHint {
  kind: 'environment';
  message: string;
  details?: string;
}

/** A setting's value as the message writes it: a string as it is, anything else as JSON text, nothing as `undefined`. */
export function settingValueText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/** The environment hints of a record: one for each setting, then the editor, the extension and the client. */
export function environmentHints(
  snapshot: EnvironmentSnapshot,
): EnvironmentHint[] {
  return [
    ...snapshot.settings.map((setting): EnvironmentHint => ({
      kind: 'environment',
      message: `Extension setting '${setting.name}' is set to value '${settingValueText(setting.value)}'`,
      ...(setting.description === undefined
        ? {}
        : {details: setting.description}),
    })),
    {
      kind: 'environment',
      message: `VS Code version: ${snapshot.editorVersion}`,
    },
    {
      kind: 'environment',
      message: `Remote-SSH version: remote-ssh@${snapshot.extensionVersion}`,
    },
    {
      kind: 'environment',
      message: `${snapshot.platform} ${snapshot.architecture}`,
    },
  ];
}

/**
 * The number of each error hint's status, written out. A record, the README and the rows depend on these numbers, so
 * the table only grows: a new status takes the next unused number, and no number is changed or used twice. The first
 * numbers follow the order the classifier tries its forms, then the hints the connect adds itself.
 */
export const STATUS_NUMBERS: Readonly<Record<string, number>> = {
  PermissionDenied: 1,
  InvalidHostName: 2,
  OfflineError: 3,
  MitmPortForwardingDisabled: 4,
  AllowTcpForwardingDisabled: 5,
  SendDisconnectBrokenPipe: 6,
  ServerDownloadFailed: 7,
  NoDownloaderAvailable: 8,
  InvalidProxyUrl: 9,
};

/** The number of `status`, or none for a status the table does not hold. */
export function statusNumberOf(status: string): number | undefined {
  return Object.hasOwn(STATUS_NUMBERS, status)
    ? STATUS_NUMBERS[status]
    : undefined;
}
