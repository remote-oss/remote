/**
 * @fileoverview The licence gate (V6): the one place that asks the user to accept the server's licence terms before a
 * server is installed or started. Whether a server comes under the terms is decided by lib-product's rules; this
 * module only classifies with them, remembers an acceptance per profile, and shows the modal through a port.
 */

import {logOncePerSession, type Logger} from 'lib-log';
import {
  classifyLicence,
  type LicenceFacts,
  licenceTermsUrl,
  type LicenceRuleName,
} from 'lib-product';

/** Whether a server comes under the licence terms, and the page that shows them. */
export type LicenceClassification =
  {kind: 'microsoftLicensed'; termsUrl: string} | {kind: 'free'};

/** What the editor's product.json says about the licence terms. */
export interface LicenceTerms {
  /** Whether its list of licence lines is empty. */
  serverLicenseEmpty: boolean;
  /** Its link to the terms; empty when it names none. */
  serverLicenseUrl: string;
}

/** What the user answered to the modal. */
export type ModalAnswer = 'accept' | 'cancel';

/** The editor's modal: the extension's own wording around the terms link, with "Accept and Continue" and "Cancel". */
export interface LicenceModal {
  askUser(termsUrl: string, cancellation: AbortSignal): Promise<ModalAnswer>;
}

/** The record of acceptances: per profile, never synced, one entry per terms page. */
export interface AcceptanceStore {
  isAccepted(storeKey: string): boolean;
  accept(storeKey: string): Promise<void>;
}

/** How the gate ended. */
export type GateOutcome =
  /**
   * The server may be installed or started; `acceptanceFlag` is whether the server is started with the flag, and
   * `remembered` whether the user's acceptance was stored (false when the store failed: they are asked again next time).
   */
  | {kind: 'cleared'; acceptanceFlag: boolean; remembered: boolean}
  /** The user cancelled: nothing is downloaded, copied, started or remembered (reason STR:S027). */
  | {kind: 'licenceDeclined'}
  /** The caller cancelled while the question was open, or had already cancelled: nothing is stored or started. */
  | {kind: 'cancelled'};

/** The key under which the acceptance of a terms page is stored. */
export function acceptanceKey(termsUrl: string): string {
  return `serverLicence:${termsUrl}`;
}

/** Whether a server comes under the terms, by the rules in force, and the page that shows them. */
export function classifyServerLicence(
  facts: LicenceFacts,
  terms: LicenceTerms,
  activeRules?: readonly LicenceRuleName[],
): LicenceClassification {
  return classifyLicence(facts, activeRules)
    ? {
        kind: 'microsoftLicensed',
        termsUrl: licenceTermsUrl(
          terms.serverLicenseEmpty,
          terms.serverLicenseUrl,
        ),
      }
    : {kind: 'free'};
}

/**
 * Clears a server for use. A free server needs no acceptance and gets no flag. A licensed one is cleared by a stored
 * acceptance of its terms page, or by the user's answer to the modal; "Cancel" and a modal that fails both decline,
 * and the gate never accepts for the user.
 */
export async function ensureAccepted(
  classification: LicenceClassification,
  store: AcceptanceStore,
  modal: LicenceModal,
  logger: Logger,
  cancellation: AbortSignal,
): Promise<GateOutcome> {
  if (classification.kind === 'free') {
    return {kind: 'cleared', acceptanceFlag: false, remembered: false};
  }
  const storeKey = acceptanceKey(classification.termsUrl);
  if (store.isAccepted(storeKey)) {
    return {kind: 'cleared', acceptanceFlag: true, remembered: true};
  }
  if (cancellation.aborted) {
    return {kind: 'cancelled'};
  }
  const answer = await askUserOrCancelled(
    modal,
    classification.termsUrl,
    cancellation,
  );
  if (answer === 'cancelled') {
    return {kind: 'cancelled'};
  }
  if (answer !== 'accept') {
    return {kind: 'licenceDeclined'};
  }
  try {
    await store.accept(storeKey);
  } catch (caught) {
    // The user did accept: the server may start in this session, and the question comes back next time.
    logOncePerSession(
      logger,
      'licenceAcceptanceNotStored',
      `the licence acceptance could not be stored: ${caught instanceof Error ? caught.message : String(caught)}`,
      'warn',
    );
    return {kind: 'cleared', acceptanceFlag: true, remembered: false};
  }
  return {kind: 'cleared', acceptanceFlag: true, remembered: true};
}

/**
 * The user's answer, or the caller's cancellation winning the race. A modal that throws, rejects or is dismissed
 * without an answer is a "Cancel".
 */
async function askUserOrCancelled(
  modal: LicenceModal,
  termsUrl: string,
  cancellation: AbortSignal,
): Promise<ModalAnswer | 'cancelled'> {
  let cancelledResolve: (value: 'cancelled') => void;
  const cancelled = new Promise<'cancelled'>(resolve => {
    cancelledResolve = resolve;
  });
  function onAbort(): void {
    cancelledResolve('cancelled');
  }
  cancellation.addEventListener('abort', onAbort, {once: true});
  try {
    return await Promise.race([
      answerOf(modal, termsUrl, cancellation),
      cancelled,
    ]);
  } finally {
    cancellation.removeEventListener('abort', onAbort);
  }
}

/** The user's answer; a modal that throws, rejects or is dismissed without an answer is a "Cancel". */
async function answerOf(
  modal: LicenceModal,
  termsUrl: string,
  cancellation: AbortSignal,
): Promise<ModalAnswer> {
  try {
    const answer = await modal.askUser(termsUrl, cancellation);
    return answer === 'accept' ? 'accept' : 'cancel';
  } catch {
    // A modal that fails never counts as an acceptance.
    return 'cancel';
  }
}
