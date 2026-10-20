/**
 * @fileoverview The configuration an open command goes on with, for a folder that may hold none: when it holds none,
 * the wizard writes one and the choice is made again over the written file. The wizard runs before the window reloads
 * and never reloads it, so the command's own reload follows.
 */

import type {WizardOutcome} from '../authoring/wizard-stages.ts';
import {type CommandChecksPorts, commandBeforeReload} from './pre-reload.ts';

/** The wizard, for the commands that author a configuration first. */
export interface AuthoringPort {
  authoring: {
    /** Runs the wizard for the folder. */
    execute(folder: string): Promise<WizardOutcome>;
  };
}

/**
 * The checks before a reload over `folder`; with no configuration there, the wizard runs, and a written one is chosen by
 * a second pass whose engine check is the first's. Anything else the wizard ends with leaves the command with nothing
 * to reload.
 */
export async function chooseOrAuthor(
  ports: CommandChecksPorts & AuthoringPort,
  firstCheck: Parameters<typeof commandBeforeReload>[1],
  request: {title: string; folder: string; dockerPath: string},
): ReturnType<typeof commandBeforeReload> {
  const {title, folder, dockerPath} = request;
  const first = await commandBeforeReload(
    ports,
    firstCheck,
    folder,
    dockerPath,
  );
  if (first.choice.kind !== 'noConfiguration') {
    return first;
  }
  first.progress.close();
  ports.logger.info(`${title} found no configuration in ${folder}`);
  const outcome = await ports.authoring.execute(folder);
  if (outcome.kind !== 'written') {
    return {choice: {kind: 'dismissed'}, progress: first.progress};
  }
  return commandBeforeReload(
    ports,
    () => Promise.resolve('proceed'),
    folder,
    dockerPath,
  );
}
