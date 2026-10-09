/**
 * @fileoverview The claim on a window's one notification. The family's extensions share one local extension host per
 * window, and registering a command there is synchronous and throws for an id that is already registered. So the
 * extension that registers the claim command holds the window, the others ask it who that is, and an extension host
 * restart, the only way a holder goes while the window lives, clears every claim.
 */

import type {WindowClaim} from './setup.ts';

/** The command a holder registers; it answers with the extension id that holds the window. */
export const CLAIM_COMMAND = 'remote-oss.gate.claim';

/** What a claim needs of the editor. */
export interface ClaimHost {
  /** Registers a command and returns what releases it; throws when the command is already registered. */
  registerCommand(command: string, handler: () => string): {dispose(): void};
  executeCommand(command: string): PromiseLike<unknown>;
}

/** Registers the claim, or says false when another extension holds it. */
function tryRegister(
  host: ClaimHost,
  extensionId: string,
  subscriptions: Array<{dispose(): void}>,
): boolean {
  try {
    subscriptions.push(host.registerCommand(CLAIM_COMMAND, () => extensionId));
    return true;
  } catch {
    // Another extension registered the command first.
    return false;
  }
}

/** The extension id the holder answers with, or nothing when there is no holder to ask. */
async function askHolder(host: ClaimHost): Promise<string | undefined> {
  try {
    const holder = await host.executeCommand(CLAIM_COMMAND);
    return typeof holder === 'string' ? holder : undefined;
  } catch {
    // The holder went away between the registration that failed and the question.
    return undefined;
  }
}

/**
 * The claim of one extension. `subscriptions` is the extension's own list of things to release on deactivation, so
 * a registration it makes is released with it. The steps, in order: register the claim; when that throws, ask the
 * holder; when that fails too, register once more; a second failure leaves the holder unknown, which the caller
 * treats as another extension holding the window.
 */
export function windowClaimOf(
  host: ClaimHost,
  subscriptions: Array<{dispose(): void}>,
): WindowClaim {
  return {
    claim: async extensionId => {
      if (tryRegister(host, extensionId, subscriptions)) {
        return {holder: extensionId};
      }
      const holder = await askHolder(host);
      if (holder !== undefined) {
        return {holder};
      }
      return tryRegister(host, extensionId, subscriptions)
        ? {holder: extensionId}
        : {holder: undefined};
    },
  };
}
