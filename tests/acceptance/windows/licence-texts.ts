import {readFileSync} from 'node:fs';
import path from 'node:path';

/** The display name of Remote - SSH, as its manifest gives it. */
export const DISPLAY_NAME = (
  JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'remote-ssh',
        'package.json',
      ),
      'utf8',
    ),
  ) as {displayName: string}
).displayName;

/** The buttons of a dialog as core's custom dialog draws them on Linux: in the reverse of the order of its items, core's own Cancel being the last item. */
export function drawn(items: readonly string[]): string[] {
  return [...items].reverse();
}

/** The licence modal's message. */
export const LICENCE_MESSAGE = "Accept the server's licence terms?";

/** The licence modal's detail, with the display name and the terms' address (§5a). */
export function licenceDetail(termsUrl: string): string {
  return `The server ${DISPLAY_NAME} installs or starts on this host is distributed under licence terms of its own, which ${DISPLAY_NAME} does not accept for you. Read them at ${termsUrl} before you continue. "Accept and Continue" accepts them for this profile; the choice is remembered for this profile.`;
}
