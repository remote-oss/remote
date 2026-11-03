/**
 * @fileoverview The settings a session record lists and the snapshot the environment hints are built from: each setting read by its own name, whether or not the manifest declares it, and described by the manifest
 * where BR-9 gives details.
 */

import type {EnvironmentSnapshot, SettingSnapshot} from 'lib-ssh';

/** A setting of the record, by its name without the `remote.SSH.` prefix, and whether BR-9 gives it details. */
interface RecordedSetting {
  name: string;
  described: boolean;
}

/**
 * The settings in the order the record lists them. `defaultExtensionsIfInstalledLocally` and `loglevel` are not declared
 * by the manifest and are read by exactly those names, so a value shows only if the user wrote exactly that key.
 */
export const RECORDED_SETTINGS: readonly RecordedSetting[] = [
  {name: 'useLocalServer', described: true},
  {name: 'useExecServer', described: true},
  {name: 'bindHost', described: true},
  {name: 'path', described: true},
  {name: 'configFile', described: true},
  {name: 'useFlock', described: true},
  {name: 'lockfilesInTmp', described: true},
  {name: 'localServerDownload', described: true},
  {name: 'remoteServerListenOnSocket', described: true},
  {name: 'defaultExtensions', described: true},
  {name: 'defaultExtensionsIfInstalledLocally', described: false},
  {name: 'loglevel', described: false},
  {name: 'enableDynamicForwarding', described: true},
  {name: 'enableRemoteCommand', described: true},
  {name: 'serverPickPortsFromRange', described: true},
  {name: 'serverInstallPath', described: true},
  {name: 'permitPtyAllocation', described: true},
  {name: 'preferredLocalPortRange', described: true},
  {name: 'useCurlAndWgetConfigurationFiles', described: true},
  {name: 'experimental.enhancedSessionLogs', described: true},
  {name: 'httpProxy', described: true},
  {name: 'httpsProxy', described: true},
];

/** The prefix of the extension's settings. */
const SETTING_PREFIX = 'remote.SSH.';

/** The declared settings of a manifest, each with its description or the key of the description in the strings file. */
export type ManifestSettings = Readonly<
  Record<
    string,
    {description?: string; markdownDescription?: string} | undefined
  >
>;

/**
 * The description of each declared setting, by its name without the prefix: the text of the manifest, or, when it is a
 * `%key%` reference, the text the strings file gives that key.
 */
export function descriptionsOf(
  settings: ManifestSettings,
  strings: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const [key, declaration] of Object.entries(settings)) {
    const text = declaration?.description ?? declaration?.markdownDescription;
    if (key.startsWith(SETTING_PREFIX) && text !== undefined) {
      const reference = /^%(.+)%$/u.exec(text)?.[1];
      const resolved = reference === undefined ? text : strings[reference];
      if (resolved !== undefined) {
        descriptions[key.slice(SETTING_PREFIX.length)] = resolved;
      }
    }
  }
  return descriptions;
}

/** What the snapshot is read from. */
export interface SessionEnvironmentSource {
  /** The effective value of `remote.SSH.<name>`: `getConfiguration('remote.SSH').get(name)`. */
  read: (name: string) => unknown;
  descriptions: Readonly<Record<string, string>>;
  editorVersion: string;
  extensionVersion: string;
  platform: string;
  architecture: string;
}

/** The snapshot the environment hints are built from, with every setting read now. */
export function sessionEnvironmentOf(
  source: SessionEnvironmentSource,
): EnvironmentSnapshot {
  return {
    settings: RECORDED_SETTINGS.map((setting): SettingSnapshot => {
      const description = setting.described
        ? source.descriptions[setting.name]
        : undefined;
      return {
        name: setting.name,
        value: source.read(setting.name),
        ...(description === undefined ? {} : {description}),
      };
    }),
    editorVersion: source.editorVersion,
    extensionVersion: source.extensionVersion,
    platform: source.platform,
    architecture: source.architecture,
  };
}
