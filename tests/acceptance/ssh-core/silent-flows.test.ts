import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  commandEventsSince,
  commandsOf,
  connectionLog,
  editorProduct,
  inWindow,
  startInWindow,
  onHost,
  openWindow,
  runShellTask,
  terminalNames,
  variable,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {windowFolderOf} from '../windows/agent-standing.ts';
import {
  explainedFailure,
  section,
  settledSection,
} from '../windows/connect-failure.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  notificationCentre,
  notifications,
  pageText,
  paletteRows,
  toastFacts,
  typeInTerminal,
} from '../windows/renderer.ts';

/** The prefixes of the commands that the extension registers. */
const COMMAND_PREFIXES = ['remote-ssh.', 'remote-internal.', 'opensshremotes.'];

/** What the extension has shown or written in window `window`, as the criterion lists it. */
interface Footprint {
  toasts: string[];
  centre: string[];
  logLines: number;
  storage: string[];
  commands: string[];
  settings: string[];
  /** The palette titles of the extension, by the category its commands show. */
  palette: string[];
}

/** The titles of the extension's settings that the Settings editor of `window` lists. */
async function settingTitles(window: string): Promise<string[]> {
  await inWindow(
    window,
    'workbench.action.openSettings',
    '@ext:remote-oss.remote-ssh',
  );
  await new Promise(resolve => setTimeout(resolve, 3000));
  const lines = (await pageText(window)).split('\n');
  await inWindow(window, 'workbench.action.closeActiveEditor');
  return [
    ...new Set(lines.filter(line => /^Remote\.?\s?SSH/.test(line))),
  ].sort();
}

/**
 * The commands of window `window` under each prefix, one prefix after the other: the harness tells a report from its
 * predecessors by their count, so two asks of the window's commands at once would take each other's answers.
 */
async function commandsOfEach(window: string): Promise<string[]> {
  return COMMAND_PREFIXES.reduce<Promise<string[]>>(
    async (before, prefix) => [
      ...(await before),
      ...(await commandsOf(window, prefix)),
    ],
    Promise.resolve([]),
  );
}

async function footprintOf(window: string): Promise<Footprint> {
  // The palette is read first: the notification centre, once open, keeps the keyboard.
  const palette = (await paletteRows(window, 'Remote-SSH:')).sort();
  return {
    toasts: await notifications(window),
    centre: await notificationCentre(window),
    logLines: connectionLog().length,
    // Without SQLite's rollback journal of the editor's own state database, by its name: it exists only while a write is
    // open, and is the editor's; a file of the extension's that ends the same way would still show.
    storage: readdirSync(
      path.join(variable('HARNESS_USER_DATA'), 'User', 'globalStorage'),
    )
      .filter(name => name !== 'state.vscdb-journal')
      .sort(),
    commands: await commandsOfEach(window),
    settings: await settingTitles(window),
    palette,
  };
}

/**
 * The standing of the row's node debug session when the wait ends, from the window's text before and after the Debug
 * Console is asked for: the pick stands while a start waits for a configuration, the console names a session that
 * began, and the toolbar stands while one runs.
 */
function debugSessionStanding(
  shown: string,
  revealed: string,
): {
  state: string;
  evidence: string;
} {
  if (shown.includes('Select a configuration')) {
    return {
      state: 'the configuration pick stood open',
      evidence: "the pick 'Select a configuration' in the window",
    };
  }
  if (revealed.includes('exited with code')) {
    return {
      state: 'the node session started and ended',
      evidence: "the console's 'exited with code' line",
    };
  }
  if (shown.includes('Run app')) {
    return {
      state: 'the node session stood running',
      evidence: "the session's 'Run app' toolbar in the window",
    };
  }
  if (revealed.includes('Starting debug session')) {
    return {
      state: 'the node session started',
      evidence: "the console's 'Starting debug session' line",
    };
  }
  return {
    state: 'no pick, session or console line stood',
    evidence: 'the window and the revealed console named the session nowhere',
  };
}

/** The lines of `text` stamped (UTC) from `fromMs` to `toMs`, with the unstamped lines after a kept one; the last `cap`. */
function stampedBetween(
  text: string,
  fromMs: number,
  toMs: number,
  cap: number,
): string[] {
  const kept: string[] = [];
  let keeping = false;
  for (const line of text.split('\n')) {
    const stamp = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)/.exec(line);
    if (stamp !== null) {
      const time = Date.parse(`${stamp[1] ?? ''}T${stamp[2] ?? ''}Z`);
      keeping = time >= fromMs && time <= toMs;
    }
    if (keeping) {
      kept.push(line.slice(0, 400));
    }
  }
  return kept.slice(-cap);
}

/** The logs of the host's server that name the remote extension host, between `fromMs` and `toMs` (probe, card #2646). */
async function hostLogSections(
  fromMs: number,
  toMs: number,
): Promise<string[]> {
  const listed = await onHost(
    'sh',
    '-c',
    "find /home/harness -type f -path '*logs*' -name '*.log' 2>/dev/null; true",
  ).catch(() => '');
  const files = listed.split('\n').filter(file => file !== '');
  const sections = [section('the host’s log files', () => files.join('\n'))];
  for (const file of files.filter(each =>
    /remoteexthost|remoteagent|ptyhost/.test(each),
  )) {
    sections.push(
      await settledSection(`the host’s ${file} in the 95 s`, async () =>
        stampedBetween(await onHost('cat', file), fromMs, toMs, 150).join('\n'),
      ),
    );
  }
  return sections;
}

/** The window's own logs (renderer, extension host, remote extension host) between `fromMs` and `toMs` (probe). */
function windowLogSections(
  window: string,
  fromMs: number,
  toMs: number,
): string[] {
  const logFolder = windowEvents(window)
    .filter(each => each.event === 'activated')
    .at(-1)?.logFolder;
  const folder =
    logFolder === undefined ? undefined : windowFolderOf(logFolder);
  if (folder === undefined) {
    return [section('the window’s logs', () => '(no window folder)')];
  }
  const files = readdirSync(folder, {recursive: true, encoding: 'utf8'}).filter(
    file => /(renderer|exthost|remoteexthost)\.log$/.test(file),
  );
  return files.map(file =>
    section(`the window’s ${file} in the 95 s (in ${folder})`, () => {
      const text = readFileSync(path.join(folder, file), 'utf8');
      const lines = text.split('\n');
      const between = stampedBetween(text, fromMs, toMs, 150);
      return `${String(lines.length)} lines, first ${lines[0] ?? ''}, last ${lines.at(-2) ?? ''}, range ${new Date(fromMs).toISOString()} to ${new Date(toMs).toISOString()}\n${(between.length > 0 ? between : lines.slice(-15)).join('\n')}`;
    }),
  );
}

describe('the extension in the core flows of an SSH window (card connect-125)', function () {
  this.timeout(600_000);

  for (const round of Array.from({length: 10}, (each, place) => place + 1)) {
    it(`F-2508 AC-21 (c125-silent-${String(round)}): after the terminal, the code command, the remote settings, a node program debugged to its end, a shell task and the Extensions view, the extension has shown no notification, logged no line, added nothing to the profile’s globalStorage, and registered no command or setting it lacked before`, async () => {
      const folder = `c125-silent-${String(round)}`;
      await onHost(
        'sh',
        '-c',
        `mkdir -p /home/harness/${folder} && echo note > /home/harness/${folder}/note.txt`,
      );
      const host = (await onHost('hostname')).trim();
      await onHost(
        'sh',
        '-c',
        `cat > /home/harness/${folder}/app.js <<'EOF'\nconsole.log('c125-ran-on-' + require('os').hostname());\nEOF\nmkdir -p /home/harness/${folder}/.vscode && cat > /home/harness/${folder}/.vscode/launch.json <<'EOF'\n{"version":"0.2.0","configurations":[{"type":"node","request":"launch","name":"Run app","program":"\${workspaceFolder}/app.js"}]}\nEOF`,
      );
      await openWindow('harness', folder);
      try {
        await inWindow(folder, 'workbench.action.terminal.new');
        await waitFor(
          'the first terminal',
          async () => (await terminalNames(folder)).length === 1,
          30_000,
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
        const before = await footprintOf(folder);

        // 5.1: a second terminal.
        await inWindow(folder, 'workbench.action.terminal.new');
        await waitFor(
          'two terminals',
          async () => (await terminalNames(folder)).length === 2,
          30_000,
        );
        // 5.2: the code command opens a host file in the window.
        await typeInTerminal(
          folder,
          `${editorProduct().applicationName} /home/harness/${folder}/note.txt\n`,
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
        // 5.3: the remote settings of the host.
        await runFromPalette(
          folder,
          'Preferences: Open Remote Settings (JSON) (SSH: harness)',
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
        // 5.4: a node program is debugged to its end.
        // The start returns once the session is up, which on a slow host takes longer than a command may; the program's
        // output below is what the row waits for.
        const debugStartAt = Date.now();
        await startInWindow(folder, 'workbench.action.debug.start');
        await waitFor(
          'the program to print in the Debug Console',
          async () => (await pageText(folder)).includes(`c125-ran-on-${host}`),
          90_000,
        ).catch(async (caught: unknown) => {
          // What the window shows when the wait ends tells a program that did not start (a pick, a dialog) from one whose
          // output did not reach the console; the standing names the session's state and the seconds since the start. Each
          // fact is its own section, so a read that fails is told in its place and the wait's own failure stays first.
          throw await explainedFailure(caught, async () => {
            const seconds = Math.round((Date.now() - debugStartAt) / 1000);
            const shown = await pageText(folder).catch(() => '(unreadable)');
            // Then the Debug Console is asked for, so that a program that ran while another panel was shown reads
            // differently from a session that never started.
            await startInWindow(
              folder,
              'workbench.debug.action.toggleRepl',
            ).catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, 3000));
            const revealed = await pageText(folder).catch(() => '(unreadable)');
            const from = debugStartAt - 5000;
            const until = Date.now();
            const hostSections = await hostLogSections(from, until);
            const windowSections = windowLogSections(folder, from, until);
            return [
              ...hostSections,
              ...windowSections,
              section(
                'the launch’s connection log, last 120 lines (Remote - SSH)',
                () => connectionLog({withTimes: true}).slice(-120).join('\n'),
              ),
              section('the debug session', () => {
                const standing = debugSessionStanding(shown, revealed);
                return `${String(seconds)} s after the debug start it stood at ${standing.state} (${standing.evidence})`;
              }),
              section('the window (its last 1500 characters)', () =>
                JSON.stringify(shown.slice(-1500)),
              ),
              section(
                'the window after the Debug Console was asked for (its last 600 characters)',
                () =>
                  `the program's line is ${revealed.includes(`c125-ran-on-${host}`) ? 'there' : 'not there'}: ${JSON.stringify(revealed.slice(-600))}`,
              ),
              // A start the agent only accepted is still running, one that failed says why, and one that is done with no
              // session standing is the editor's.
              section(
                'the window agent’s events about the commands since the debug start',
                () => {
                  const lines = commandEventsSince(folder, debugStartAt);
                  return lines.length === 0 ? 'none' : lines.join('\n');
                },
              ),
            ].join('\n');
          });
        });
        await new Promise(resolve => setTimeout(resolve, 5000));
        await inWindow(folder, 'workbench.action.debug.stop').catch(
          () => undefined,
        );
        // 5.5: a shell task runs to its end.
        const taskExit = await runShellTask(folder, 'echo c125-task');
        // 5.6: the Extensions view.
        await inWindow(folder, 'workbench.view.extensions');
        await new Promise(resolve => setTimeout(resolve, 5000));

        const after = await footprintOf(folder);
        // The toasts and the centre are read together, with the centre open, and none is the extension's.
        await notificationCentre(folder);
        const ours = (await toastFacts(folder)).filter(each =>
          each.source.includes('Remote - SSH'),
        );
        deepStrictEqual(
          [
            after,
            before.settings.length > 0,
            before.commands.length > 0,
            before.palette.length > 0,
            ours,
            taskExit,
          ],
          [before, true, true, true, [], 0],
        );
      } finally {
        await closeWindow(folder).catch(() => undefined);
      }
    });
  }
});
