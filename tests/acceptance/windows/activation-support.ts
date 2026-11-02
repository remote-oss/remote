/**
 * @fileoverview What the rows about Remote - SSH's activation share (F-2001): the extension's id, the palette entries of
 * a local window, the log of a window's extension host and the groups of the remote indicator's menu.
 */

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {editorLogsFolder, inWindow, waitFor} from './harness.ts';
import {paletteItems} from './palette.ts';
import {
  groupedQuickPickRows,
  type GroupedQuickPickRow,
  pressEscape,
} from './renderer.ts';

/** The id of Remote - SSH. */
export const SSH_EXTENSION = 'remote-oss.remote-ssh';

/** The 13 "Remote-SSH:" entries of the Command Palette in a local window (F-2001 5.0 step 2, remote-ssh#11), as the palette sorts them. */
export const LOCAL_ENTRIES: readonly string[] = [
  'Remote-SSH: Add New SSH Host...',
  'Remote-SSH: Clear previous session metadata (used for enhanced error reporting)',
  'Remote-SSH: Connect Current Window to Host...',
  'Remote-SSH: Connect to Host...',
  'Remote-SSH: Get Started with SSH',
  'Remote-SSH: Help',
  'Remote-SSH: Kill Local Connection Server For Host...',
  'Remote-SSH: Kill VS Code Server on Host...',
  'Remote-SSH: Open SSH Configuration File...',
  'Remote-SSH: Report Issue...',
  'Remote-SSH: Settings',
  'Remote-SSH: Show Log',
  'Remote-SSH: Uninstall VS Code Server from Host...',
];

/** The 15 "Remote-SSH:" entries of the Command Palette in a connected SSH window (F-2001 6.2 step 7, remote-ssh#11). */
export const CONNECTED_ENTRIES: readonly string[] = [
  'Remote-SSH: Add New SSH Host...',
  'Remote-SSH: Clear previous session metadata (used for enhanced error reporting)',
  'Remote-SSH: Connect Current Window to Host...',
  'Remote-SSH: Connect to Host...',
  'Remote-SSH: Help',
  'Remote-SSH: Kill Current VS Code Server',
  'Remote-SSH: Kill Local Connection Server For Host...',
  'Remote-SSH: Kill VS Code Server on Host...',
  'Remote-SSH: New Window on Active Host',
  'Remote-SSH: Open SSH Configuration File...',
  'Remote-SSH: Provide Feedback',
  'Remote-SSH: Report Issue...',
  'Remote-SSH: Settings',
  'Remote-SSH: Show Log',
  'Remote-SSH: Uninstall VS Code Server from Host...',
];

/** The extension host logs the editor has written so far, one for each window, as paths below the logs folder. */
function extensionHostLogs(): string[] {
  const logs = editorLogsFolder();
  return existsSync(logs)
    ? readdirSync(logs, {recursive: true, encoding: 'utf8'}).filter(
        file => path.basename(file) === 'exthost.log',
      )
    : [];
}

/** The order of two log paths by the number of their window folder, `window2` before `window10`. */
function byWindowNumber(left: string, right: string): number {
  function numberOf(file: string): number {
    return Number(/window(\d+)/.exec(file)?.[1] ?? 0);
  }
  return numberOf(left) - numberOf(right);
}

/**
 * Opens a window with `open`, which gives its name, and finds the log of its extension host: the one that was not there
 * before. A window opened this way must be the only one that starts meanwhile, and the newest one has the log with the highest window number.
 */
export async function windowWithLog(
  open: () => Promise<string>,
): Promise<{name: string; logFile: string}> {
  const before = new Set(extensionHostLogs());
  const name = await open();
  let fresh: string[] = [];
  try {
    await waitFor(
      `the extension host log of window ${name}`,
      () => {
        fresh = extensionHostLogs().filter(file => !before.has(file));
        return fresh.length > 0;
      },
      30_000,
    );
  } catch (caught) {
    throw new Error(
      `${caught instanceof Error ? caught.message : String(caught)}; new logs: ${JSON.stringify(fresh)}, all: ${JSON.stringify(extensionHostLogs())}`,
      {cause: caught},
    );
  }
  // The newest window has the highest number; the launch's own first window may have written its log only now.
  return {name, logFile: [...fresh].sort(byWindowNumber).at(-1) ?? ''};
}

/** The activation events that activated Remote - SSH in the extension host whose log is `logFile`, in order. */
export function sshActivations(logFile: string): string[] {
  return readFileSync(path.join(editorLogsFolder(), logFile), 'utf8')
    .split('\n')
    .filter(line => line.includes(`_doActivateExtension ${SSH_EXTENSION},`))
    .map(line => /activationEvent: '([^']*)'/.exec(line)?.[1] ?? line);
}

/** The Command Palette entries of window `name` that start with "Remote-SSH:", other extensions' rows not counted. */
export async function remoteSshEntries(name: string): Promise<string[]> {
  return (await paletteItems(name, 'Remote-SSH:')).filter(label =>
    label.startsWith('Remote-SSH: '),
  );
}

/** The rows of the remote indicator's menu of window `name`, each with the separator that opens its group. */
export async function indicatorGroups(
  name: string,
): Promise<GroupedQuickPickRow[]> {
  void inWindow(name, 'workbench.action.remote.showMenu').catch(
    () => undefined,
  );
  // The menu has replaced the list that was open before, whatever it was, once it holds the extension's own first entry.
  await waitFor(
    'the indicator menu',
    async () =>
      (await groupedQuickPickRows(name).catch(() => [])).some(
        each => each.label === 'Connect to Host...',
      ),
    30_000,
  );
  const rows = await groupedQuickPickRows(name);
  await pressEscape(name);
  return rows;
}

/** How many settings of Remote - SSH are not deprecated: the properties of its manifest's configuration with no deprecation message. */
export function nonDeprecatedSettings(): number {
  const manifest = JSON.parse(
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
  ) as {
    contributes: {
      configuration:
        | {properties: Record<string, Record<string, unknown>>}
        | Array<{properties: Record<string, Record<string, unknown>>}>;
    };
  };
  const sections = [manifest.contributes.configuration].flat();
  return sections
    .flatMap(section => Object.values(section.properties))
    .filter(
      setting =>
        setting.deprecationMessage === undefined &&
        setting.markdownDeprecationMessage === undefined,
    ).length;
}
