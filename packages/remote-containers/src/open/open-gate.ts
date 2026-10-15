/**
 * @fileoverview The guard of every command that ends in a container window: without the proposals that window needs,
 * the command shows the setup notice and leaves the user's window as it is, since nothing could resolve the new one.
 */

import type {Logger} from 'lib-log';

/** The proposals without which a window on a container authority can't open. */
const OPEN_PATH_PROPOSALS: readonly string[] = ['resolvers', 'workspaceTrust'];

/** What the guard reads of the activation's setup. */
export interface OpenGatePorts {
  /** What the activation's probe found missing. */
  missing: readonly string[];
  /** Probes again and shows the warning within its cap; only the new decision is read. */
  setupAgain(): Promise<{decision: {missing: readonly string[]}}>;
  logger: Logger;
}

/** The members of `missing` that the open path needs. */
function neededOf(missing: readonly string[]): string[] {
  return missing.filter(name => OPEN_PATH_PROPOSALS.includes(name));
}

/**
 * Whether a command that ends in a container window may go on: yes when none of the open path's proposals is missing;
 * otherwise the setup runs again once, and the command goes on only when the new probe finds them all. A probe that
 * fails counts as not finding them.
 */
export async function openPathAllowed(
  ports: OpenGatePorts,
  command: string,
): Promise<boolean> {
  if (neededOf(ports.missing).length === 0) {
    return true;
  }
  let missingAfter: readonly string[];
  try {
    missingAfter = (await ports.setupAgain()).decision.missing;
  } catch (error) {
    ports.logger.warn(
      `${command} could not probe the proposed API again: ${error instanceof Error ? error.message : String(error)}; the window stays as it is`,
    );
    return false;
  }
  const stillMissing = neededOf(missingAfter);
  if (stillMissing.length === 0) {
    return true;
  }
  ports.logger.info(
    `${command} needs the proposed API: ${stillMissing.join(', ')}; the window stays as it is`,
  );
  return false;
}
