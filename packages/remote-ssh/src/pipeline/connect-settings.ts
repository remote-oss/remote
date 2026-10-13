/**
 * @fileoverview The settings a connect reads, each read when its step needs it, so a change takes effect at the next
 * connect: the server's per-host values, the connection's request, the terms, the tunnel's path and the shared
 * connection's switches. The values are as the editor reports them; the steps judge them.
 */

import {effectiveUseLocalServer, type TunnelSettings} from 'lib-forwarding';
import {readSetting, type SettingHost} from 'lib-identifiers';
import type {LocalDownloadMode} from 'lib-server';
import type {OverrideValue} from 'lib-product';
import {settings} from '../identifiers.generated.ts';
import type {ConnectionRequestSettings} from './connection-request.ts';
import type {RawServerSettings} from './host-settings.ts';
import type {TermsSettings} from './terms-steps.ts';

/** A setting's value, as the editor reports it. */
export function valueOf(
  host: SettingHost,
  entry: keyof typeof settings,
): unknown {
  return readSetting(host, settings[entry]);
}

/** A switch's value: true only for the boolean true. */
export function switchOf(
  host: SettingHost,
  entry: keyof typeof settings,
): boolean {
  return valueOf(host, entry) === true;
}

/** A setting's text, or the empty text for any other value. */
export function textOf(
  host: SettingHost,
  entry: keyof typeof settings,
): string {
  const value = valueOf(host, entry);
  return typeof value === 'string' ? value : '';
}

/**
 * Where a connect may download the server archive: `off` when `remote.SSH.allowLocalServerDownload` is
 * false, else `remote.SSH.localServerDownload` when it is `always` or `off`, else `auto`.
 */
export function localDownloadModeOf(host: SettingHost): LocalDownloadMode {
  if (valueOf(host, 'allowLocalServerDownload') === false) {
    return 'off';
  }
  const mode = valueOf(host, 'localServerDownload');
  return mode === 'always' || mode === 'off' ? mode : 'auto';
}

/** The per-host server settings, as written. */
export function serverSettingsOf(host: SettingHost): RawServerSettings {
  return {
    serverInstallPath: valueOf(host, 'serverInstallPath'),
    bindHost: valueOf(host, 'bindHost'),
    serverPickPortsFromRange: valueOf(host, 'serverPickPortsFromRange'),
    httpProxy: valueOf(host, 'httpProxy'),
    httpsProxy: valueOf(host, 'httpsProxy'),
    reconnectionGraceTime: valueOf(host, 'reconnectionGraceTime'),
    defaultExtensions: valueOf(host, 'defaultExtensions'),
    useFlock: valueOf(host, 'useFlock'),
    lockfilesInTmp: valueOf(host, 'lockfilesInTmp'),
    useCurlAndWgetConfigurationFiles: valueOf(
      host,
      'useCurlAndWgetConfigurationFiles',
    ),
  };
}

/** The settings of the connection's request. */
export function connectionSettingsOf(
  host: SettingHost,
): ConnectionRequestSettings {
  return {
    configFile: textOf(host, 'configFile'),
    connectTimeout: valueOf(host, 'connectTimeout'),
    permitPtyAllocation: valueOf(host, 'permitPtyAllocation'),
    externalAskpass: switchOf(host, 'externalSSHAskpass'),
  };
}

/** The settings the terms read. */
export function termsSettingsOf(host: SettingHost): TermsSettings {
  return {
    useLocalServer: switchOf(host, 'useLocalServer'),
    remotePlatform: valueOf(host, 'remotePlatform'),
    windowsRemotes: valueOf(host, 'windowsRemotes'),
    enableRemoteCommand: switchOf(host, 'enableRemoteCommand'),
  };
}

/** The settings that choose the window tunnel's path and whether the shared connection is used. */
export function tunnelSettingsOf(host: SettingHost): TunnelSettings {
  return {
    listenOnSocket: switchOf(host, 'remoteServerListenOnSocket'),
    useLocalServer: switchOf(host, 'useLocalServer'),
    enableDynamicForwarding: switchOf(host, 'enableDynamicForwarding'),
  };
}

/**
 * The user's server download template and its layer. The setting applies to the whole application, so the value the
 * editor holds for the user is the default profile's; an empty or non-text value is no override.
 */
export function overrideOf(host: SettingHost): OverrideValue | undefined {
  const {globalValue} = host.inspectSetting(
    settings.serverDownloadUrlTemplate.id,
  );
  return typeof globalValue === 'string' && globalValue !== ''
    ? {value: globalValue, layer: 'defaultProfileUser'}
    : undefined;
}

/** Whether a connect runs in terminal mode: each window its own `ssh`, when the shared connection is not in effect. */
export function terminalModeOf(host: SettingHost): boolean {
  return !effectiveUseLocalServer(tunnelSettingsOf(host));
}
