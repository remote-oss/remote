/**
 * @fileoverview The steps that settle the terms of a connection before any `ssh` runs and remember what the host
 * reported once the connect has worked: the platform from the settings or from the user, the host's remote command,
 * and the write to `remote.SSH.remotePlatform`.
 */

import type {Logger} from 'lib-log';
import type {PlatformPickVariant} from '../connect/platform-picker.ts';
import {hostAlias} from './host-settings.ts';
import {
  decidePlatform,
  PLATFORM_OF_PROBE,
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
    variant: PlatformPickVariant,
    cancellation: AbortSignal,
  ) => Promise<RemotePlatform | undefined>;
  /** Shows the notice for the platform about to be stored; the connect does not wait for it. */
  announcePlatform: (platform: RemotePlatform) => void;
  /** Sets the exact key for the alias in `remote.SSH.remotePlatform`. */
  writePlatform: (alias: string, platform: RemotePlatform) => Promise<void>;
  /** Where the step says whether it wrote the platform the host reported, and why not. */
  logger: Logger;
}

type TermsStepNames =
  'decideTerms' | 'pickAfterBrokenPipe' | 'rememberPlatform';

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
        const picked = await dependencies.pickPlatform(
          alias,
          'ask',
          cancellation,
        );
        if (picked === undefined) {
          // The extension's own pick dismissed: the connect was cancelled by the user, as the licence decline.
          return {
            kind: 'failed',
            failure: {kind: 'cancelled', reason: {id: 'S027'}},
          };
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
    pickAfterBrokenPipe: (input, cancellation) =>
      dependencies.pickPlatform(
        hostAlias(input.target),
        'brokenPipe',
        cancellation,
      ),
    rememberPlatform: async (input, reported) => {
      const alias = hostAlias(input.target);
      const settings = dependencies.settings();
      const write = platformWrite(settings, alias, PLATFORM_OF_PROBE[reported]);
      if (write.kind === 'set') {
        dependencies.logger.debug(
          `the platform ${write.platform} of host ${alias} is being written to the settings`,
        );
        dependencies.announcePlatform(write.platform);
        await dependencies.writePlatform(alias, write.platform);
        dependencies.logger.debug(
          `the platform ${write.platform} of host ${alias} was written to the settings`,
        );
        return;
      }
      dependencies.logger.debug(
        `the platform of host ${alias} was not written to the settings: ${settings.useLocalServer ? 'the shared connection is on' : `it already holds ${PLATFORM_OF_PROBE[reported]}`}`,
      );
    },
  };
}
