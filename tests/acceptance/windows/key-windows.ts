/**
 * @fileoverview Windows opened through the aliases of the run's keys, and the waits on their passphrase input, shared by
 * the suites of F-2307.
 */

import {readFileSync} from 'node:fs';
import {inWindow, onHostAs, variable, waitFor, windowState} from './harness.ts';
import {
  answerInputBox,
  connectSurface,
  inputBoxOf,
  quickPickOf,
} from './renderer.ts';

/** The run's passphrase. */
export function passphrase(): string {
  return readFileSync(variable('HARNESS_PASSPHRASE_FILE'), 'utf8').trim();
}

/** Opens a window on folder `label` of the user `harness` through the alias `alias`; the window is named `label`. */
export async function openKeyWindow(
  alias: string,
  label: string,
): Promise<string> {
  await onHostAs('harness', 'mkdir', '-p', `/home/harness/${label}`);
  void inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+${alias}/home/harness/${label}`,
  );
  return label;
}

/** Waits until the passphrase input of window `name` is open; gives what it shows. */
export async function untilPassphraseInput(
  name: string,
  milliseconds = 90_000,
) {
  await waitFor(
    `the passphrase input of ${name}`,
    async () =>
      (await inputBoxOf(name))?.placeholder.startsWith('Enter passphrase') ===
      true,
    milliseconds,
  );
  return inputBoxOf(name);
}

/** Waits until window `name` is connected through `alias`: its remote name and its indicator say so. */
export async function untilConnected(
  name: string,
  alias: string,
): Promise<void> {
  await waitFor(
    'the window to connect',
    async () =>
      (await windowState(name)).remoteName === 'ssh-remote' &&
      (await connectSurface(name)).indicator === `SSH: ${alias}`,
    120_000,
  );
}

/** Ends the shared connection of `alias` with Kill Local Connection Server For Host..., run in window `name`. */
export async function killSharedConnection(
  name: string,
  alias: string,
): Promise<void> {
  void inWindow(name, 'opensshremotes.cleanLocalServer');
  await waitFor(
    'the host pick',
    async () => (await quickPickOf(name)) !== undefined,
    60_000,
  );
  // The pick lists more hosts than it draws, so the alias is typed into its filter.
  await answerInputBox(name, alias);
}
