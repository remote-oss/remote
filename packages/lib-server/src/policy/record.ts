/** Where the server archive is downloaded: on the host first, on the client and then the host, or only on the client. */
export type DownloadPlacement =
  | {kind: 'hostFirst'; mode: 'auto' | 'always' | 'off'}
  | {kind: 'clientFirstThenHost'}
  | {kind: 'clientOnly'};

/** How a downloaded archive is checked, in the order applied. */
export type Verification = 'headerHash' | 'lengthOnly' | 'none';

/**
 * Whether the host's requirements are checked, and by whom. `bundledHelper`: lib-server runs the server's
 * `bin/helpers/check-requirements.sh` before each launch; exit 99 aborts the start with the helper's output.
 */
export type RequirementsCheck =
  'none' | 'serverBundled' | 'serverBundledPlusAlpineProbe' | 'bundledHelper';

/** Whether a default extension entry reaches the server as written, or only when it is a `publisher.name` identifier. */
export type ExtensionEntries = 'identifiersOnly' | 'asWritten';

/** An extra start option the record allows the extension to add. */
export type ExtraStartOption = 'fileWatcherPolling' | 'useHostProxy';

/** What happens to older installs after a new one. */
export type Cleanup =
  | {kind: 'keepNewest'; count: number}
  | {kind: 'onlyCurrentRemoveLeftovers'}
  | {kind: 'onlyCurrentKeepLeftovers'};

/** How the install script is shaped: one script that does it all, or one per step. */
export type InstallMode = 'singleScript' | 'stepwise';

/** The umask the install and start scripts apply, or the umask they inherit from the shell. */
export type InstallUmask = 'inherit' | '022';

/** When the archive for the next product update is fetched in the background, or never. */
export type Prefetch =
  | {kind: 'none'}
  | {
      kind: 'onProductUpdate';
      settingKey: string;
      feedCheckIntervalMilliseconds: number;
      platformWindowDays: number;
      licence: 'skipUnaccepted';
    };

/** One extension's server policy: every value the installer reads, and nothing it branches on. */
export interface ServerPolicyRecord {
  downloadPlacement: DownloadPlacement;
  cache: 'none' | 'kept';
  verification: readonly Verification[];
  environmentSetup: string | undefined;
  requirementsCheck: RequirementsCheck;
  allowedExtraStartOptions: readonly ExtraStartOption[];
  extensionEntries: ExtensionEntries;
  installUmask: InstallUmask;
  cleanup: Cleanup;
  installMode: InstallMode;
  prefetch: Prefetch;
}

/** One problem a candidate record has, with the JSON-path-like position of the bad value. */
export interface PolicyProblem {
  path: string;
  problem: string;
}
