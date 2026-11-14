/**
 * @fileoverview The steps that settle the terms of a connection before any `ssh` runs and remember what the host
 * reported once the connect has worked: the platform from the settings or from the user, the host's remote command,
 * and the write to `remote.SSH.remotePlatform`.
 */

import type {Scheduler} from 'lib-helper';
import type {Logger} from 'lib-log';
import type {PlatformPickVariant} from '../connect/platform-picker.ts';
import {
  PLATFORM_RETRY_PAUSE_MILLISECONDS,
  PLATFORM_WRITE_MILLISECONDS,
} from './bounds.ts';
import {hostAlias} from './host-settings.ts';
import {
  decidePlatform,
  PLATFORM_OF_PROBE,
  type PlatformSettings,
  platformWrite,
  type RemotePlatform,
  remoteCommandInEffect,
  storedPlatformOf,
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
  /** Sets the exact key for the alias in `remote.SSH.remotePlatform`, from the settings as they are when it is called. */
  writePlatform: (alias: string, platform: RemotePlatform) => Promise<void>;
  /** The window's log, where the decision to write the platform and the outcome of the write are told. */
  logger: Logger;
  /** The timers of the write's bound and of the pause before its retry. */
  scheduler: Scheduler;
}

/** How one try of the write ended: it worked, the editor refused it with `message`, or it did not settle in time. */
type WriteOutcome =
  {kind: 'written'} | {kind: 'refused'; message: string} | {kind: 'unfinished'};

/** One try of `write`, ended by the bound `PLATFORM_WRITE_MILLISECONDS` when the editor's update does not settle. */
function triedWrite(
  dependencies: TermsStepDependencies,
  alias: string,
  platform: RemotePlatform,
): Promise<WriteOutcome> {
  return new Promise<WriteOutcome>(resolve => {
    const stop = dependencies.scheduler.setTimer(
      PLATFORM_WRITE_MILLISECONDS,
      () => {
        resolve({kind: 'unfinished'});
      },
    );
    dependencies.writePlatform(alias, platform).then(
      () => {
        stop();
        resolve({kind: 'written'});
      },
      (caught: unknown) => {
        stop();
        resolve({kind: 'refused', message: String(caught)});
      },
    );
  });
}

/** What the log says of a try that did not work. */
function failureLine(
  outcome: Exclude<WriteOutcome, {kind: 'written'}>,
): string {
  return outcome.kind === 'unfinished'
    ? `the platform setting's write did not finish within ${String(PLATFORM_WRITE_MILLISECONDS / 1000)} s`
    : `the platform setting's write was refused: ${outcome.message}`;
}

/** Waits `PLATFORM_RETRY_PAUSE_MILLISECONDS`. */
function pausedBeforeRetry(scheduler: Scheduler): Promise<void> {
  return new Promise<void>(resolve => {
    scheduler.setTimer(PLATFORM_RETRY_PAUSE_MILLISECONDS, resolve);
  });
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
      const platform = PLATFORM_OF_PROBE[reported];
      const settings = dependencies.settings();
      const stored = storedPlatformOf(settings.remotePlatform, alias);
      const told = `the remotePlatform entry of ${alias} was ${stored ?? 'none'}; the host reports ${platform}`;
      const write = platformWrite(settings, alias, platform);
      if (write.kind === 'none') {
        dependencies.logger.info(
          `${told}; keeping it: ${settings.useLocalServer ? 'the local connection server is on' : 'the entry already holds it'}`,
        );
        return;
      }
      dependencies.logger.info(`${told}; writing it`);
      dependencies.announcePlatform(write.platform);
      const first = await triedWrite(dependencies, alias, write.platform);
      if (first.kind === 'written') {
        return;
      }
      dependencies.logger.info(failureLine(first));
      await pausedBeforeRetry(dependencies.scheduler);
      // The retry is built from the settings as they are now: the write reads them when it is called.
      const fresh = dependencies.settings();
      if (platformWrite(fresh, alias, platform).kind === 'none') {
        dependencies.logger.info(
          `the remotePlatform entry of ${alias} now holds the reported platform; keeping it`,
        );
        return;
      }
      const second = await triedWrite(dependencies, alias, write.platform);
      if (second.kind !== 'written') {
        throw new Error(failureLine(second));
      }
      dependencies.logger.info(
        'the platform setting was written on the second attempt',
      );
    },
  };
}
