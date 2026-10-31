/**
 * @fileoverview The check of the Features a configuration asks for against the control manifest, made while the window
 * is still local: a Feature the manifest disallows is refused with a modal, and nothing is reloaded or created.
 */

import {failureText} from '../surfaces/failure-strings.ts';
import {
  type ControlManifestPorts,
  controlManifestOf,
  disallowedEntryOf,
} from './control-manifest.ts';

/** What the check needs besides the manifest. */
export interface ProblematicPorts {
  manifest: ControlManifestPorts;
  /**
   * A modal warning with `message` and `detail`. Its buttons are `Learn More` (the primary one) when `learnMore` is
   * given, and `cancel`, which closes it. It says which button was chosen; the close is a cancel.
   */
  warn(
    message: string,
    detail: string,
    learnMore: string | undefined,
    cancel: string,
  ): PromiseLike<'learnMore' | 'cancel'>;
  openExternal(address: string): PromiseLike<unknown>;
}

/**
 * Whether the command must stop: the first requested Feature that the manifest disallows is told to the user, and Learn
 * More opens the entry's address when it has one.
 */
export async function problematicFeatureRefused(
  ports: ProblematicPorts,
  requested: readonly string[],
  cancellation: AbortSignal,
): Promise<boolean> {
  if (requested.length === 0) {
    return false;
  }
  const manifest = await controlManifestOf(ports.manifest, cancellation);
  const {translate} = ports.manifest;
  for (const featureId of requested) {
    const entry = disallowedEntryOf(manifest, featureId);
    if (entry === undefined) {
      continue;
    }
    const answer = await ports.warn(
      failureText('S059', [featureId], translate),
      failureText('S275', [], translate),
      entry.documentationURL === undefined
        ? undefined
        : failureText('S218', [], translate),
      translate('Cancel'),
    );
    if (answer === 'learnMore' && entry.documentationURL !== undefined) {
      await ports.openExternal(entry.documentationURL);
    }
    return true;
  }
  return false;
}
