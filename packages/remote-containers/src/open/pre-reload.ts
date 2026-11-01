/**
 * @fileoverview The checks before a reload, shared by the commands that reload the window on a dev container: C2's
 * engine check and the configuration's choice and read run together, and a progress shows when they take long. The
 * engine's outcome is the first the user sees.
 */

import {
  type ConfigSurfaces,
  type ConfigurationChoice,
  type ConfigurationPorts,
  type ConfigurationRequest,
  chooseConfiguration,
} from '../config/choose-configuration.ts';
import type {Logger} from 'lib-log';
import type {CliBridge} from '../cli/cli-bridge.ts';
import {featureSettingsOf} from '../connect/feature-settings.ts';
import {mountGitWorktreeCommonDirOf} from '../connect/mount-settings.ts';
import {
  type ProblematicPorts,
  problematicFeatureRefused,
} from '../features/problematic-check.ts';
import {requestedFeaturesOf} from '../cli/failing-feature.ts';
import type {EngineDialogPort, FirstCheckResult} from '../engine/preflight.ts';
import {
  type PreReloadProgress,
  type PreReloadProgressPorts,
  startPreReloadProgress,
} from './pre-reload-progress.ts';

/** What the checks need. */
export interface PreReloadPorts {
  /** C2's first check with the given dialogs (`firstCheck` of `preflight.ts` over the served dependencies). */
  firstCheck(
    base: string | undefined,
    dialogs: EngineDialogPort,
    cancellation: AbortSignal,
  ): Promise<FirstCheckResult>;
  dialogs: EngineDialogPort;
  config: ConfigurationPorts;
  progress: PreReloadProgressPorts;
  /** The time now, in milliseconds. */
  clock(): number;
}

/** The function, which closes `progress` before each call. */
function closing<Inputs extends unknown[], Result>(
  progress: PreReloadProgress,
  call: (...parameters: Inputs) => Result,
): (...parameters: Inputs) => Result {
  return (...parameters) => {
    progress.close();
    return call(...parameters);
  };
}

/** The dialogs, whose error dialog closes `progress` before it shows. */
function closingDialogs<Dialogs extends Pick<EngineDialogPort, 'showError'>>(
  dialogs: Dialogs,
  progress: PreReloadProgress,
): Dialogs {
  return {
    ...dialogs,
    showError: closing(progress, dialogs.showError.bind(dialogs)),
  };
}

/** The surfaces, each of which closes `progress` before it shows. */
function closingSurfaces(
  surfaces: ConfigSurfaces,
  progress: PreReloadProgress,
): ConfigSurfaces {
  return {
    pick: closing(progress, surfaces.pick.bind(surfaces)),
    dialogs: closingDialogs(surfaces.dialogs, progress),
    showWarning: closing(progress, surfaces.showWarning.bind(surfaces)),
    openPreview: closing(progress, surfaces.openPreview.bind(surfaces)),
  };
}

/** The choice, or a cancelled one, logged, when the user cancelled while the checks ran. */
function cancelledOr(
  choice: ConfigurationChoice,
  cancellation: AbortSignal,
  logger: Logger,
): {choice: ConfigurationChoice} {
  if (!cancellation.aborted) {
    return {choice};
  }
  logger.info('the command was cancelled while reading the configuration');
  return {choice: {kind: 'cancelled'}};
}

/** What the checks before a reload end with: the choice, the progress still open, and the signal Cancel aborts. */
export interface BeforeReload {
  choice: ConfigurationChoice;
  progress: PreReloadProgress;
  /** Aborted when the user cancels the progress; the work after the choice may use it too. */
  cancellation: AbortSignal;
}

/**
 * The checks before a reload: the engine and the configuration together, with S283 and a Cancel after 500 ms. Cancel
 * aborts them all: the engine's queries, the CLI's read and a pull it makes. The caller closes the progress before its
 * reload, and when it ends without one.
 */
export async function beforeReload(
  ports: PreReloadPorts,
  request: Omit<ConfigurationRequest, 'engineCheck' | 'cancellation'>,
): Promise<BeforeReload> {
  const {logger} = ports.config;
  const controller = new AbortController();
  const cancellation = controller.signal;
  const progress = startPreReloadProgress(ports.progress, () => {
    controller.abort();
  });
  const engineCheck = ports
    .firstCheck(
      request.folder,
      closingDialogs(ports.dialogs, progress),
      cancellation,
    )
    .catch((caught: unknown): FirstCheckResult => {
      logger.error(
        `the engine check failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      progress.close();
      return 'stopped';
    });
  logger.info('Reading configuration');
  const began = ports.clock();
  try {
    const choice = await chooseConfiguration(
      {...request, engineCheck, cancellation},
      {
        ...ports.config,
        surfaces: closingSurfaces(ports.config.surfaces, progress),
      },
    );
    return {
      ...cancelledOr(choice, cancellation, logger),
      progress,
      cancellation,
    };
  } catch (caught) {
    progress.close();
    if (cancellation.aborted) {
      return {
        ...cancelledOr({kind: 'stopped'}, cancellation, logger),
        progress,
        cancellation,
      };
    }
    throw caught;
  } finally {
    logger.info(`Reading configuration: ${String(ports.clock() - began)} ms`);
  }
}

/** What an open command gives the checks before its reload, besides the first check it chooses. */
export interface CommandChecksPorts {
  settings: {
    mountGitWorktreeCommonDir(): unknown;
    defaultFeatures(): unknown;
    lockfile(): unknown;
  };
  dialogs: EngineDialogPort;
  config: Omit<ConfigurationPorts, 'cli' | 'logger'>;
  bridge: Pick<CliBridge, 'readConfiguration'>;
  progress: PreReloadProgressPorts;
  clock(): number;
  /** The control manifest check of the Features, made once a configuration is chosen. */
  problematic: ProblematicPorts;
  logger: Logger;
}

/**
 * The checks before a reload of an open command, over `folder`, with the program the engine runs as `dockerPath`. With
 * `configFile` the choice is that file and no picker shows.
 */
export async function commandBeforeReload(
  ports: CommandChecksPorts,
  firstCheck: PreReloadPorts['firstCheck'],
  folder: string,
  dockerPath: string,
  configFile?: string,
): ReturnType<typeof beforeReload> {
  const result = await beforeReload(
    {
      firstCheck,
      dialogs: ports.dialogs,
      // eslint-disable-next-line id-length -- the choice's dependency is named cli
      config: {...ports.config, cli: ports.bridge, logger: ports.logger},
      progress: ports.progress,
      clock: () => ports.clock(),
    },
    {
      folder,
      dockerPath,
      mountGitWorktreeCommonDir: mountGitWorktreeCommonDirOf(
        ports.settings.mountGitWorktreeCommonDir(),
      ),
      features: featureSettingsOf(
        ports.settings.defaultFeatures(),
        ports.settings.lockfile(),
      ),
      ...(configFile === undefined ? {} : {configFile}),
    },
  );
  if (result.choice.kind !== 'chosen') {
    return result;
  }
  const requested = [
    ...new Set([
      ...result.choice.features,
      ...requestedFeaturesOf(undefined, ports.settings.defaultFeatures()),
    ]),
  ];
  try {
    if (
      await problematicFeatureRefused(
        ports.problematic,
        requested,
        result.cancellation,
      )
    ) {
      result.progress.close();
      return {
        ...cancelledOr({kind: 'rejected'}, result.cancellation, ports.logger),
        progress: result.progress,
        cancellation: result.cancellation,
      };
    }
  } catch (caught) {
    result.progress.close();
    if (result.cancellation.aborted) {
      return {
        ...cancelledOr({kind: 'rejected'}, result.cancellation, ports.logger),
        progress: result.progress,
        cancellation: result.cancellation,
      };
    }
    throw caught;
  }
  return result;
}
