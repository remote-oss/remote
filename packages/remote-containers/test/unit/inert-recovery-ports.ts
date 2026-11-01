import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {RecoveryPorts} from '../../src/surfaces/recovery-presenter.ts';

/** Ports that do nothing and answer nothing; a row replaces the ones it steers. */
export function inertRecoveryPorts(
  replaced: Partial<RecoveryPorts> = {},
): RecoveryPorts {
  return {
    showError: () => Promise.resolve(undefined),
    pick: () => Promise.resolve(undefined),
    fileExists: () => Promise.resolve(true),
    writeAttemptLog: () => Promise.resolve(undefined),
    keepEdit: () => Promise.resolve(),
    openLocally: () => Promise.resolve(),
    reloadWindow: () => Promise.resolve(),
    openRecent: () => Promise.resolve(),
    storePausedRetry: () => Promise.resolve(),
    rebuildContainer: () => Promise.resolve(),
    openExternal: () => Promise.resolve(),
    openSetting: () => Promise.resolve(),
    later: () => undefined,
    disconnected: () => undefined,
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    ...replaced,
  };
}
