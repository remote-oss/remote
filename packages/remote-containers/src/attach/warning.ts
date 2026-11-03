/**
 * @fileoverview The warning before the first attach of a profile: attaching to a container may execute arbitrary code.
 * Accepting it is kept in the profile's global state and is never asked again; Learn More and Cancel end the command and
 * keep nothing.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {IntentMemento} from '../state/timed-store.ts';

/** The key under which the profile remembers that the warning was accepted. */
export const ATTACH_TRUST_KEY =
  'remote-oss.remote-containers.attachTrustAccepted';

/** The page that Learn More opens: the section on attaching to containers in the extension's documentation. */
export const ATTACH_TRUST_PAGE =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-containers/README.md#attaching-to-a-running-container';

/** The English templates of the warning. */
const WARNING_TEMPLATES = {
  S042: 'Attaching to a container may execute arbitrary code.',
  S251: 'Only attach to a container if you trust its origin.',
  gotIt: 'Got It',
  learnMore: 'Learn More',
} as const;

/** What the warning needs of the editor. */
export interface AttachWarningPorts {
  /** The profile's global state. */
  global: IntentMemento;
  /** Shows a modal warning with its detail and the buttons; the chosen one, or none for core's Cancel or Escape. */
  show(
    message: string,
    detail: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  openExternal(address: string): PromiseLike<unknown>;
  translate: Translate;
}

/** Whether the command goes on: the warning was accepted now or earlier. It is shown even when workspace trust is off. */
export async function attachWarningAccepted(
  ports: AttachWarningPorts,
): Promise<boolean> {
  if (ports.global.get(ATTACH_TRUST_KEY) === true) {
    return true;
  }
  const gotIt = ports.translate(WARNING_TEMPLATES.gotIt);
  const learnMore = ports.translate(WARNING_TEMPLATES.learnMore);
  const answer = await ports.show(
    ports.translate(WARNING_TEMPLATES.S042),
    ports.translate(WARNING_TEMPLATES.S251),
    [gotIt, learnMore],
  );
  if (answer === learnMore) {
    await ports.openExternal(ATTACH_TRUST_PAGE);
  }
  if (answer !== gotIt) {
    return false;
  }
  await ports.global.update(ATTACH_TRUST_KEY, true);
  return true;
}
