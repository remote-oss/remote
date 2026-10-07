/**
 * @fileoverview The server download override of each extension: its setting, the settings layers it may come from,
 * the forms it accepts and the placeholders its templates may use.
 */

import {BASE_PLACEHOLDERS, type PlaceholderName} from './expand.ts';

/** A settings layer a value was read from. */
export type SettingsLayer =
  | 'defaultProfileUser'
  | 'profileUser'
  | 'remote'
  | 'workspace'
  | 'workspaceFolder';

/** One extension's override policy. */
export interface OverridePolicy {
  readonly settingKey: string;
  /** The layers whose value counts; a value from any other layer is ignored. */
  readonly layers: readonly SettingsLayer[];
  /** Whether a value without placeholders is a base URL that gets the archive path appended. */
  readonly acceptsBaseUrl: boolean;
  /** The placeholders the templates of every step may use for this extension. */
  readonly placeholders: readonly PlaceholderName[];
}

const ALL_LAYERS: readonly SettingsLayer[] = [
  'defaultProfileUser',
  'profileUser',
  'remote',
  'workspace',
  'workspaceFolder',
];

/** The policies by extension; an extension without an entry has no override yet. */
export const OVERRIDE_POLICIES: Readonly<
  Partial<
    Record<'remote-ssh' | 'remote-containers' | 'remote-wsl', OverridePolicy>
  >
> = {
  'remote-ssh': {
    settingKey: 'remote.SSH.serverDownloadUrlTemplate',
    layers: ['defaultProfileUser'],
    acceptsBaseUrl: false,
    placeholders: BASE_PLACEHOLDERS,
  },
  'remote-containers': {
    settingKey: 'remote.serverDownloadBaseUrl',
    layers: ALL_LAYERS,
    acceptsBaseUrl: true,
    placeholders: BASE_PLACEHOLDERS,
  },
};
