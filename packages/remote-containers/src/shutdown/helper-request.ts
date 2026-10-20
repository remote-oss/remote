/**
 * @fileoverview What the window asks lib-helper for to join the shutdown helper of its editor instance, or to start
 * it: one helper per instance, keyed under the extension's own global storage, started outside the window's process
 * tree so it outlives everything that ends the window.
 */

import path from 'node:path';
import type {AcquireRequest} from 'lib-helper';
import {SHUTDOWN_END_POLICY} from './shutdown-handler.ts';

/** The registry namespace of the shutdown helper. */
export const SHUTDOWN_NAMESPACE = 'remote-containers.shutdown';

/** The key of the one helper of an editor instance. */
export const SHUTDOWN_HELPER_KEY = 'instance';

/** How long a window waits on the helper: a running one's answer, a started one's listening, the pause between asks. */
export const SHUTDOWN_CLIENT_WAITS = {
  helloLimitMilliseconds: 2000,
  startLimitMilliseconds: 10_000,
  retryMilliseconds: 100,
} as const;

/** The request to acquire the instance's shutdown helper, for the extension at `extensionFolder` with `storageFolder`. */
export function shutdownHelperRequest(
  places: {extensionFolder: string; storageFolder: string},
  cancellation: AbortSignal,
): AcquireRequest {
  return {
    folder: {instanceOf: places.storageFolder},
    namespace: SHUTDOWN_NAMESPACE,
    helperKey: SHUTDOWN_HELPER_KEY,
    script: path.join(places.extensionFolder, 'dist', 'shutdown-helper.js'),
    leaveStarterTree: true,
    launcherScript: path.join(
      places.extensionFolder,
      'dist',
      'helper-launcher.js',
    ),
    policy: SHUTDOWN_END_POLICY,
    prepare: () => Promise.resolve({kind: 'ready', options: {}, payload: {}}),
    cancellation,
  };
}
