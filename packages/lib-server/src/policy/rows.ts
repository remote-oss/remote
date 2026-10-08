import type {ServerPolicyRecord} from './record.ts';

function deepFreeze(value: unknown): void {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
}

// Freeze the record and its nested objects; the shipped rows must be safe to share read-only.
function frozen(record: ServerPolicyRecord): ServerPolicyRecord {
  deepFreeze(record);
  return record;
}

/** The SSH policy: the host downloads the archive, nothing is cached, and five installs are kept. */
export const SSH_POLICY: ServerPolicyRecord = frozen({
  downloadPlacement: {kind: 'hostFirst', mode: 'auto'},
  cache: 'none',
  verification: ['none'],
  environmentSetup: undefined,
  requirementsCheck: 'serverBundled',
  allowedExtraStartOptions: [],
  cleanup: {kind: 'keepNewest', count: 5},
  installMode: 'singleScript',
  prefetch: {kind: 'none'},
});

/** The containers policy: the client downloads and copies the archive into the container. */
export const CONTAINERS_POLICY: ServerPolicyRecord = frozen({
  downloadPlacement: {kind: 'clientOnly'},
  cache: 'kept',
  verification: ['none'],
  environmentSetup: undefined,
  requirementsCheck: 'serverBundled',
  allowedExtraStartOptions: [],
  cleanup: {kind: 'keepNewest', count: 5},
  installMode: 'singleScript',
  prefetch: {kind: 'none'},
});

const WSL_PREFETCH_SETTING_KEY = 'remote.WSL.downloadInBackground';

/**
 * The WSL policy: a silent download in the distro after the client, the distro's environment
 * setup, and the background download for the next product update. The install mode, and the
 * cleanup that goes with it, come from the extension's script-less startup setting.
 */
export function wslPolicy(input: {
  scriptLessStartup: boolean;
  environmentSetupPath: string | undefined;
}): ServerPolicyRecord {
  const scriptLess = input.scriptLessStartup;
  const record: ServerPolicyRecord = {
    downloadPlacement: {kind: 'clientFirstThenHost'},
    cache: 'kept',
    verification: ['headerHash', 'lengthOnly'],
    environmentSetup: input.environmentSetupPath,
    requirementsCheck: 'serverBundledPlusAlpineProbe',
    allowedExtraStartOptions: ['fileWatcherPolling'],
    cleanup: scriptLess
      ? {kind: 'onlyCurrentRemoveLeftovers'}
      : {kind: 'onlyCurrentKeepLeftovers'},
    installMode: scriptLess ? 'stepwise' : 'singleScript',
    prefetch: {
      kind: 'onProductUpdate',
      settingKey: WSL_PREFETCH_SETTING_KEY,
      feedCheckIntervalMilliseconds: 3600000,
      platformWindowDays: 14,
      licence: 'skipUnaccepted',
    },
  };
  return frozen(record);
}
