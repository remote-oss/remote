/**
 * The lifecycle runs of an attached container: the container lifecycle asks a bridge for `run-user-commands` with a
 * dev container's target, and this bridge answers with the attached form, which names no folder.
 */

import type {AttachedCliTarget, CliTarget} from '../cli/cli-arguments.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';

/** The bridge whose `runUserCommands` runs on the attached container `base` names, in the terminal size it is given. */
export function attachedRunsBridge(
  bridge: CliBridge,
  base: AttachedCliTarget,
): CliBridge {
  return {
    ...bridge,
    runUserCommands: (
      target,
      containerId,
      onEvent,
      cancellation,
      onStdin,
      options,
    ) =>
      bridge.runAttachedUserCommands(
        {
          ...base,
          containerId,
          ...(target.terminalSize === undefined
            ? {}
            : {terminalSize: target.terminalSize}),
        },
        options ?? {},
        onEvent,
        cancellation,
        onStdin,
      ),
  };
}

/** The target the lifecycle holds for an attached container; the bridge above ignores all of it but the terminal size. */
export function attachedReadyTarget(base: AttachedCliTarget): CliTarget {
  return {
    workspaceFolder: '',
    configFile: base.configFile ?? '',
    dockerPath: base.dockerPath,
    idLabels: [],
    mountWorkspaceGitRoot: false,
    mountGitWorktreeCommonDir: false,
    features: {defaultFeatures: {}, lockfile: false},
    mounts: [],
    logLevel: base.logLevel,
  };
}
