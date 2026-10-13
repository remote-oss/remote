import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

/** How long the extension takes to activate, in milliseconds. */
const ACTIVATION_MILLISECONDS = 15_000;

/** Marks the start and the end of the activation with two files in the host's temporary folder. */
export async function activate(): Promise<void> {
  writeFileSync('/tmp/acceptance-slow-started', '');
  await delay(ACTIVATION_MILLISECONDS);
  writeFileSync('/tmp/acceptance-slow-done', '');
}
