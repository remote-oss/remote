import {execFileSync} from 'node:child_process';
import {
  acceptedPasswords,
  appendScript,
  connectedWithin,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
} from './harness.ts';
import {password} from './maintenance.ts';

/** A listening socket of the runner, with the program that holds it. */
export interface Listener {
  address: string;
  port: number;
  program: string;
}

/** The listening TCP sockets of the runner held by `ssh` or by the editor, as `ss -ltnp` lists them. */
export function listeners(): Listener[] {
  return execFileSync('ss', ['-ltnp'])
    .toString()
    .split('\n')
    .slice(1)
    .flatMap((line): Listener[] => {
      const columns = line.trim().split(/\s+/);
      const local = columns[3] ?? '';
      const program = /users:\(\("([^"]+)"/.exec(line)?.[1];
      if (program === undefined || !/^(ssh|codium)/.test(program)) {
        return [];
      }
      const colon = local.lastIndexOf(':');
      return [
        {
          address: local.slice(0, colon).replace(/^\[|\]$/g, ''),
          port: Number(local.slice(colon + 1)),
          program: program.startsWith('ssh') ? 'ssh' : 'editor',
        },
      ];
    });
}

/** The listeners of `after` that `before` did not hold, by port. */
export function addedSince(
  before: readonly Listener[],
  after: readonly Listener[],
): Listener[] {
  const ports = new Set(before.map(each => each.port));
  return after.filter(each => !ports.has(each.port));
}

/** What a connect of one window showed and cost. */
export interface Connected {
  /** The password questions the window was asked and answered. */
  prompts: number;
  /** The password logins the host counted since the window began to connect. */
  logins: number;
  /** The surfaces and questions of the window's record, in order. */
  sequence: string[];
  /** The listeners the connect added on the runner. */
  added: Listener[];
}

/** The settings of the rows: the platform of the hosts is stored, so that terminal mode asks no pick. */
export const PLATFORMS = {
  'remote.SSH.remotePlatform': {harness: 'linux', password: 'linux'},
};

/**
 * Opens window `name` on `alias` under `settings`, answers its password questions, waits until it is connected and
 * gives what the connect showed and cost. The settings are put back afterwards by the caller through `restoreUserSettings`.
 */
export async function connectedWith(
  name: string,
  alias: 'harness' | 'password',
  settings: Readonly<Record<string, unknown>>,
): Promise<Connected> {
  await userSettings({...PLATFORMS, ...settings});
  const before = listeners();
  const logins = await acceptedPasswords();
  appendScript([1, 2, 3].map(() => ({...password(), window: name})));
  await openWindow(alias, name);
  await connectedWithin(name, 90_000);
  await new Promise(resolve => setTimeout(resolve, 2000));
  return {
    prompts: recordLines('maskedInput', name).filter(
      line => line.answer === '<supplied>',
    ).length,
    logins: (await acceptedPasswords()) - logins,
    sequence: recordLines(undefined, name).map(
      line => `${line.surface}:${line.question}`,
    ),
    added: addedSince(before, listeners()),
  };
}

/** Runs `rowBody` with the user settings as they were at its start put back after it. */
export async function keepingSettings(
  rowBody: () => Promise<void>,
): Promise<void> {
  const saved = readUserSettings();
  try {
    await rowBody();
  } finally {
    restoreUserSettings(saved);
  }
}
