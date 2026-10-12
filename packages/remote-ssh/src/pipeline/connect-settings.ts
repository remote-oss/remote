/**
 * @fileoverview The settings a connect reads, each read when its step needs it, so a change takes effect at the next
 * connect: the server's per-host values, the connection's request, the terms, the tunnel's path and the shared
 * connection's switches. The values are as the editor reports them; the steps judge them.
 */

import type {TunnelSettings} from 'lib-forwarding';
import {readSetting, type SettingHost} from 'lib-identifiers';
import {settings} from '../identifiers.generated.ts';
import type {ConnectionRequestSettings} from './connection-request.ts';
import type {RawServerSettings} from './host-settings.ts';
import type {TermsSettings} from './terms-steps.ts';

/** A setting's value, as the editor reports it. */
function valueOf(host: SettingHost, entry: keyof typeof settings): unknown {
  return readSetting(host, settings[entry]);
}

/** A switch's value: true only for the boolean true. */
function switchOf(host: SettingHost, entry: keyof typeof settings): boolean {
  return valueOf(host, entry) === true;
}

/** A setting's text, or the empty text for any other value. */
function textOf(host: SettingHost, entry: keyof typeof settings): string {
  const value = valueOf(host, entry);
  return typeof value === 'string' ? value : '';
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
