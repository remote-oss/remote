/**
 * @fileoverview A launcher program that starts a helper outside the process tree of the window that starts it: the
 * launcher starts the helper detached and exits, so the helper's parent is gone and the helper outlives everything
 * that ends the starter's tree. A consumer bundles a program that calls `runTreeLeavingLauncher`.
 */

import {spawn} from 'node:child_process';
import type {ProcessSpawn} from '../client/node-environment.ts';

/** What the launcher needs of its own process. */
export interface LauncherProcess {
  /** The launcher's command line: the runtime, the launcher's script, then the helper's script. */
  argv: readonly string[];
  /** The runtime that runs the helper's script. */
  execPath: string;
  /** The environment the helper is started with, its parameters included. */
  environment: Readonly<Record<string, string | undefined>>;
  spawnProcess: ProcessSpawn;
  exit: (code: number) => void;
}

/** This process, as the launcher sees it. */
export function nodeLauncherProcess(): LauncherProcess {
  return {
    argv: process.argv,
    execPath: process.execPath,
    environment: process.env,
    spawnProcess: spawn,
    exit: process.exit.bind(process),
  };
}

/**
 * Starts the helper script that the command line names, on the same runtime and with the launcher's environment
 * unchanged, detached, without a console window or standard streams, and exits: 0 once the helper has started, 1
 * when it can't start or no script is named. Nothing but the script's path is on the command line.
 */
export function runTreeLeavingLauncher(
  launcher: LauncherProcess = nodeLauncherProcess(),
): void {
  const script = launcher.argv[2];
  if (script === undefined) {
    launcher.exit(1);
    return;
  }
  const child = launcher.spawnProcess(launcher.execPath, [script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: launcher.environment,
  });
  child.once('error', () => {
    launcher.exit(1);
  });
  child.once('spawn', () => {
    child.unref();
    launcher.exit(0);
  });
}
