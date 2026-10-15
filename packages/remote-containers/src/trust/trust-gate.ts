/**
 * @fileoverview The trust check every open command makes before it runs anything: when the folder isn't trusted yet it
 * asks the editor's own workspace trust dialog, with a body of ours, and the command goes on only when the user trusts
 * the folder.
 */

import type {Logger} from 'lib-log';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** What the check reads and asks of the editor. */
export interface TrustPort {
  /** `workspace.isTrusted`: true also when the editor's workspace trust is turned off. */
  isTrusted(): boolean;
  /**
   * The editor's modal trust request with `message` as its body; true only when the user trusted the folder. It
   * rejects when the editor refuses the `workspaceTrust` proposal.
   */
  request(message: string): Promise<boolean>;
}

/** How a trust check ended: go on, or stop with nothing run. */
export type TrustOutcome = 'trusted' | 'declined' | 'unavailable';

/** What the check needs besides the port. */
export interface TrustNeeds {
  translate: Translate;
  logger: Logger;
  /** Runs the proposed-API setup again, which shows its setup notice. */
  setupAgain(): Promise<unknown>;
  /** The command's title as the log names it. */
  commandTitle: string;
}

/** The English template of the body the extension gives the editor's trust dialog, by its string id. */
export const TRUST_TEMPLATES = {
  S265: 'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.',
  S360: 'The local folder is currently not trusted.',
  S377: 'Trust is required to build a dev container from it. The folder will now reopen locally.',
} as const;

/** The text of an error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Asks the editor to trust the window's folder when it isn't trusted yet. A command goes on only on `trusted`, and does
 * nothing else otherwise: a declined window is left as it was. It never throws.
 */
export async function ensureTrusted(
  port: TrustPort,
  needs: TrustNeeds,
): Promise<TrustOutcome> {
  if (port.isTrusted()) {
    return 'trusted';
  }
  const {logger, commandTitle} = needs;
  try {
    if (await port.request(needs.translate(TRUST_TEMPLATES.S265))) {
      logger.info(`the folder is trusted now; ${commandTitle} goes on`);
      return 'trusted';
    }
    logger.info(`the folder isn't trusted; ${commandTitle} does nothing`);
    return 'declined';
  } catch (error) {
    logger.warn(`the trust request failed: ${messageOf(error)}`);
    try {
      await needs.setupAgain();
    } catch (setupError) {
      logger.warn(`the proposed-API setup failed: ${messageOf(setupError)}`);
    }
    return 'unavailable';
  }
}
