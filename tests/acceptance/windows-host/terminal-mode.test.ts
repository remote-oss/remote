/**
 * @fileoverview F-2701 AC-5 and AC-6 on the run's Windows SSH host (card #2678): a window connects to `winhost` with
 * the platform decided as Windows, in terminal mode, where the extension writes each run's frame to its own login
 * terminal, and in local-server mode. OpenSSH Server's `DefaultShell` is switched between Windows PowerShell, cmd and
 * PowerShell 7 for the connects that need it, and put back after.
 */

import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {
  connectionLog,
  inWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  terminalFacts,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';

/** The alias of the run's Windows SSH host. */
const ALIAS = 'winhost';

/** The registry key of Windows' OpenSSH Server, whose `DefaultShell` value is the shell a session starts. */
const OPENSSH_KEY = 'HKLM\\SOFTWARE\\OpenSSH';

/** The shells a connect runs under, by the name the rows give them. */
const SHELLS = {
  windowsPowershell:
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  commandPrompt: 'C:\\Windows\\System32\\cmd.exe',
  powershellSeven: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
} as const;

type Shell = keyof typeof SHELLS;

/** How long a connect may take, the server install included, in milliseconds. */
const CONNECT_MILLISECONDS = 240_000;

/** What a log line of a POSIX script run by a Windows shell would hold. */
const POSIX_ERROR =
  /is not recognized as|command not found|syntax error|unexpected token|: not found/i;

/** The `DefaultShell` the host has now, or `none`. */
function defaultShell(): string {
  try {
    const listing = execFileSync(
      'reg',
      ['query', OPENSSH_KEY, '/v', 'DefaultShell'],
      {encoding: 'utf8'},
    );
    return /DefaultShell\s+REG_SZ\s+(.+)/.exec(listing)?.[1]?.trim() ?? 'none';
  } catch {
    return 'none';
  }
}

/** Makes `program` the shell of the host's next sessions. */
function useShell(program: string): void {
  execFileSync('reg', [
    'add',
    OPENSSH_KEY,
    '/v',
    'DefaultShell',
    '/t',
    'REG_SZ',
    '/d',
    program,
    '/f',
  ]);
}

/** The folder of window `name` in the host account's home, which is this machine's. */
function folderOf(name: string): string {
  return path.join(homedir(), name);
}

/** Opens window `name` on the Windows host, in a folder of the account's home made first, from the local window. */
async function openOnHost(name: string): Promise<void> {
  mkdirSync(folderOf(name), {recursive: true});
  const remotePath = `/${folderOf(name).replaceAll('\\', '/')}`;
  await inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+${ALIAS}${remotePath}`,
  );
  await waitFor(
    `window ${name} to activate its agent`,
    () => windowEvents(name).some(each => each.event === 'activated'),
    60_000,
  );
}

/** Whether window `name` is on the remote and a file it writes reaches the host's folder. */
async function connectedOnHost(name: string): Promise<boolean> {
  try {
    const state = await windowState(name);
    await inWindow(name, 'acceptance.agent.writeFile', 'probe.txt', name);
    const probe = path.join(folderOf(name), 'probe.txt');
    return (
      state.remoteName === 'ssh-remote' &&
      existsSync(probe) &&
      readFileSync(probe, 'utf8') === name
    );
  } catch {
    return false;
  }
}

/** What one connect showed. */
interface Seen {
  name: string;
  connected: boolean;
  picks: number;
  platform: string[];
  posixErrors: string[];
  /** For a connect that failed: the end of its window's active terminal and its last log lines with their times. */
  terminal?: string;
  timedLog?: string[];
}

/** Opens window `name` and gives what its connect showed; a connect that fails is a value, not a throw. */
async function connectSeen(name: string): Promise<Seen> {
  const logStart = connectionLog().length;
  const picksBefore = recordLines('platformPick').length;
  const connected = await openOnHost(name)
    .then(() =>
      waitFor(
        `${name} to be connected`,
        () => connectedOnHost(name),
        CONNECT_MILLISECONDS,
      ),
    )
    .then(
      () => true,
      () => false,
    );
  const lines = connectionLog().slice(logStart);
  const seen: Seen = {
    name,
    connected,
    picks: recordLines('platformPick').length - picksBefore,
    platform: lines.filter(line => line.startsWith('Host platform:')),
    posixErrors: lines.filter(line => POSIX_ERROR.test(line)),
  };
  if (connected) {
    return seen;
  }
  const facts = await terminalFacts(name).catch((failed: unknown) => ({
    text: `unread: ${String(failed)}`,
    terminals: [],
  }));
  return {
    ...seen,
    terminal: `${JSON.stringify(facts.terminals)} ${(facts.text ?? '').slice(-1500)}`,
    timedLog: connectionLog({withTimes: true})
      .slice(logStart)
      .filter(line => !line.includes('Searched for ssh in'))
      .slice(-20),
  };
}

/** The last lines of the connection log, for a failure to show. */
function logTail(): string {
  return JSON.stringify(connectionLog().slice(-60));
}

describe('a Windows SSH host in terminal mode and local-server mode (card #2678, F-2701)', function () {
  this.timeout(1_800_000);
  let saved: string | undefined;
  let shellBefore = 'none';

  before(() => {
    variable('HARNESS_WINHOST_PORT');
    saved = readUserSettings();
    shellBefore = defaultShell();
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    useShell(shellBefore === 'none' ? SHELLS.windowsPowershell : shellBefore);
    await closeAllButLocal();
  });

  it('F-2701 AC-6 (c2678-mapped): with the alias mapped to windows, by remotePlatform or by windowsRemotes, a connect in terminal mode under each shell, and one in local-server mode, shows no platform pick, reports a Windows host and connects', async () => {
    const mapped = {
      'remote.SSH.remotePlatform': {[ALIAS]: 'windows'},
      'remote.SSH.windowsRemotes': [],
    };
    const connects: Array<{
      label: string;
      shell: Shell;
      settings: Record<string, unknown>;
    }> = [
      {
        label: 'c2678-local-ps',
        shell: 'windowsPowershell',
        settings: {...mapped, 'remote.SSH.useLocalServer': true},
      },
      {
        label: 'c2678-term-ps',
        shell: 'windowsPowershell',
        settings: {...mapped, 'remote.SSH.useLocalServer': false},
      },
      {
        label: 'c2678-term-cmd',
        shell: 'commandPrompt',
        settings: {...mapped, 'remote.SSH.useLocalServer': false},
      },
      {
        label: 'c2678-term-pwsh',
        shell: 'powershellSeven',
        settings: {...mapped, 'remote.SSH.useLocalServer': false},
      },
      {
        label: 'c2678-term-legacy-list',
        shell: 'windowsPowershell',
        settings: {
          'remote.SSH.useLocalServer': false,
          'remote.SSH.remotePlatform': {},
          'remote.SSH.windowsRemotes': [ALIAS],
        },
      },
    ];
    const seen: Array<Seen & {shellRead: string}> = [];
    // One write per connect, every setting it needs in it: a second write right after a first can go unseen by the window.
    for (const each of connects) {
      await userSettings(each.settings);
      useShell(SHELLS[each.shell]);
      const shellRead = defaultShell();
      seen.push({...(await connectSeen(each.label)), shellRead});
      await closeAllButLocal();
    }
    console.log(`c2678-mapped measured: ${JSON.stringify(seen)}`);
    deepStrictEqual(
      seen.map(each => ({
        name: each.name,
        connected: each.connected,
        picks: each.picks,
        posixErrors: each.posixErrors,
      })),
      connects.map(each => ({
        name: each.label,
        connected: true,
        picks: 0,
        posixErrors: [],
      })),
      `${JSON.stringify(seen)}; the last log lines: ${logTail()}`,
    );
  });

  it('F-2701 AC-5 (c2678-picked-part): with no platform entry, in terminal mode, picking Windows in the platform pick goes on to the host-side step under the Windows program, with no POSIX-shell error, and connects', async () => {
    await userSettings({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': {},
      'remote.SSH.windowsRemotes': [],
    });
    useShell(SHELLS.windowsPowershell);
    writeFileSync(
      variable('REMOTE_OSS_ACCEPTANCE_SCRIPT'),
      JSON.stringify({
        entries: [{surface: 'platformPick', match: ALIAS, answer: 'windows'}],
      }),
    );
    const seen = await connectSeen('c2678-picked');
    const asked = recordLines('platformPick');
    console.log(
      `c2678-picked measured: ${JSON.stringify({seen, asked: asked.slice(-1)})}`,
    );
    deepStrictEqual(
      {
        connected: seen.connected,
        answers: asked.map(line => line.answer),
        posixErrors: seen.posixErrors,
      },
      {connected: true, answers: ['windows'], posixErrors: []},
      `${JSON.stringify({seen, asked})}; the last log lines: ${logTail()}`,
    );
  });
});
