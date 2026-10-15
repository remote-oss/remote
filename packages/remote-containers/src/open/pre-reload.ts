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
  ): Promise<FirstCheckResult>;
  dialogs: EngineDialogPort;
  config: ConfigurationPorts;
  progress: PreReloadProgressPorts;
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
    showInformation: closing(progress, surfaces.showInformation.bind(surfaces)),
  };
}

/**
 * The checks before a reload: the engine and the configuration together, with S087 after 500 ms. The caller closes the
 * progress before its reload, and when it ends without one.
 */
export async function beforeReload(
  ports: PreReloadPorts,
  request: Omit<ConfigurationRequest, 'engineCheck'>,
): Promise<{choice: ConfigurationChoice; progress: PreReloadProgress}> {
  const {logger} = ports.config;
  const progress = startPreReloadProgress(ports.progress);
  const engineCheck = ports
    .firstCheck(request.folder, closingDialogs(ports.dialogs, progress))
    .catch((caught: unknown): FirstCheckResult => {
      logger.error(
        `the engine check failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      progress.close();
      return 'stopped';
    });
  try {
    const choice = await chooseConfiguration(
      {...request, engineCheck},
      {
        ...ports.config,
        surfaces: closingSurfaces(ports.config.surfaces, progress),
      },
    );
    return {choice, progress};
  } catch (caught) {
    progress.close();
    throw caught;
  }
}
