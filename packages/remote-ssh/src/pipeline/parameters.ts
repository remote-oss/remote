/**
 * @fileoverview The parameters of the server scripts and of the server start, put together from the product's names,
 * the extension's policy record, what the settings say about the host, and the waits the package bounds. Nothing is
 * decided here that a setting, the policy or a bound does not say.
 */

import {type ProductProfile, serverDataFolderNameOrDefault} from 'lib-product';
import {
  proxyVariableText,
  type RuntimeOptions,
  type ScriptParameters,
  type ServerPolicyRecord,
} from 'lib-server';
import type {HostServerSettings} from './host-settings.ts';

/** The names the product gives the server on the host. */
export interface ServerNames {
  commit: string;
  /** The folder in the install root that holds the server, such as the product's server data folder. */
  dataFolderName: string;
  /** The launcher's path inside an installed server folder. */
  launcher: string;
}

/** The names the product's profile gives the server: the commit, the data folder and the launcher. */
export function serverNamesOf(profile: ProductProfile): ServerNames {
  return {
    commit: profile.commit,
    dataFolderName: serverDataFolderNameOrDefault(profile),
    launcher: `bin/${profile.serverApplicationName}`,
  };
}

/** The format of an archive, by the name its address ends in: a `.zip` is a zip, anything else a gzipped tar. */
export function archiveFormatOf(address: string): 'zip' | 'tar.gz' {
  return /^[^?#]*\.zip(?:[?#]|$)/i.test(address) ? 'zip' : 'tar.gz';
}

/** The waits the package bounds, in seconds. */
export interface ServerBounds {
  downloadSeconds: number;
  readySeconds: number;
}

/** Everything that goes into the script parameters. */
export interface ParameterInput {
  names: ServerNames;
  policy: ServerPolicyRecord;
  settings: HostServerSettings;
  /** The user name on the host, for the name of the lock file. */
  remoteUser: string;
  /** The host's system once it is known; the lock is taken with `flock` only on Linux. */
  hostOperatingSystem: 'linux' | 'darwin' | undefined;
  /** The address of the archive when the plan has one, else the empty text. */
  archiveUrl: string;
  epochMilliseconds: number;
  bounds: ServerBounds;
}

/** The start options for a server: the settings' values, with the licence flag as the licence gate left it. */
export function runtimeOptionsFor(
  settings: HostServerSettings,
  bounds: ServerBounds,
  licenceAccepted = false,
): RuntimeOptions {
  return {
    bindHost: settings.bindHost.bindHost,
    portRange: settings.portRange,
    licenceAccepted,
    graceSeconds: settings.graceSeconds,
    defaultExtensions: settings.defaultExtensions,
    fileWatcherPollingMilliseconds: 0,
    readySeconds: bounds.readySeconds,
    socketMode: false,
  };
}

/** The parameters of every script of one connect. */
export function scriptParametersFor(input: ParameterInput): ScriptParameters {
  const {settings, policy} = input;
  const options = runtimeOptionsFor(settings, input.bounds);
  return {
    installRoot:
      settings.installFolder.kind === 'folder'
        ? settings.installFolder.folder
        : '',
    dataFolderName: input.names.dataFolderName,
    launcher: input.names.launcher,
    commit: input.names.commit,
    archiveUrl: input.archiveUrl,
    archivePath: '',
    removeArchive: false,
    archiveFormat: archiveFormatOf(input.archiveUrl),
    epochMilliseconds: input.epochMilliseconds,
    proxy: {
      http: proxyVariableText(settings.httpProxy),
      https: proxyVariableText(settings.httpsProxy),
    },
    downloader: {
      useConfigurationFiles: settings.useConfigurationFiles,
      timeoutSeconds: input.bounds.downloadSeconds,
    },
    lock: {
      method:
        settings.useFlock && input.hostOperatingSystem === 'linux'
          ? 'flock'
          : 'link',
      inTemporaryFolder: settings.lockfilesInTmp,
      filePrefix: `remote-lock.${input.remoteUser}`,
    },
    environmentSetup: policy.environmentSetup ?? '',
    cleanup: policy.cleanup,
    start: {
      bindHost: options.bindHost,
      port: options.portRange === '' ? '0' : options.portRange,
      licenceAccepted: options.licenceAccepted,
      graceSeconds: options.graceSeconds,
      extensions: options.defaultExtensions,
      fileWatcherPollingMilliseconds: options.fileWatcherPollingMilliseconds,
      readySeconds: options.readySeconds,
      socketMode: options.socketMode,
    },
  };
}
