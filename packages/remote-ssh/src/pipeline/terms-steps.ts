/**
 * @fileoverview The steps that settle the terms of a connection before any `ssh` runs and remember what the host
 * reported once the connect has worked: the platform from the settings or from the user, the host's remote command,
 * and the write to `remote.SSH.remotePlatform`.
 */

import {hostAlias} from './host-settings.ts';
import {
  decidePlatform,
  type PlatformSettings,
  platformWrite,
  type RemotePlatform,
  remoteCommandInEffect,
} from './platform.ts';
import type {ConnectSteps} from './steps.ts';

/** The settings the terms read, with `remote.SSH.enableRemoteCommand`. */
export interface TermsSettings extends PlatformSettings {
  enableRemoteCommand: boolean;
}

/** What the terms steps are made from. */
export interface TermsStepDependencies {
  /** The settings as they are now; read for each connect, so a change takes effect at the next one. */
  settings: () => TermsSettings;
  /** Asks the user for the host's platform; none when the user dismisses the picker or the connect is cancelled. */
  pickPlatform: (
    alias: string,
    cancellation: AbortSignal,
  ) => Promise<RemotePlatform | undefined>;
  /** Sets the exact key for the alias in `remote.SSH.remotePlatform`. */
  writePlatform: (alias: string, platform: RemotePlatform) => Promise<void>;
}

type TermsStepNames = 'decideTerms' | 'rememberPlatform';

/** The platform the editor names for an operating system the probe reports. */
const PLATFORM_OF_PROBE = {linux: 'linux', darwin: 'macOS'} as const;

/** The steps that decide the terms and remember the platform. */
export function createTermsSteps(
  dependencies: TermsStepDependencies,
): Pick<ConnectSteps, TermsStepNames> {
  return {
    decideTerms: async (input, cancellation) => {
      const settings = dependencies.settings();
      const alias = hostAlias(input.target);
      const decision = decidePlatform(settings, alias);
      let platform: RemotePlatform | 'unknown' = 'unknown';
      if (decision.kind === 'decided') {
        platform = decision.platform;
      } else if (decision.kind === 'ask') {
        const picked = await dependencies.pickPlatform(alias, cancellation);
        if (picked === undefined) {
          return {kind: 'failed', failure: {kind: 'cancelled'}};
        }
        platform = picked;
      }
      return {
        kind: 'done',
        value: {
          platform,
          remoteCommandInEffect: remoteCommandInEffect(
            settings.enableRemoteCommand,
            settings,
            alias,
          ),
        },
      };
    },
    rememberPlatform: async (input, reported) => {
      const alias = hostAlias(input.target);
      const write = platformWrite(
        dependencies.settings(),
        alias,
        PLATFORM_OF_PROBE[reported],
      );
      if (write.kind === 'set') {
        await dependencies.writePlatform(alias, write.platform);
      }
    },
  };
}
