/**
 * @fileoverview The configuration-file rows of F-2201 (card coverage-20, #142): which SSH configuration files are
 * read when the hosts are listed and when a window connects, in a plain editor whose `HOME` is a folder of the run
 * and whose `SSH_AUTH_SOCK` is empty. A row sets `remote.SSH.configFile` through the run's user settings (absent
 * means the key removed), and observes the host pick, the configuration file pick, the connects and the log. The
 * run's base setting is replaced row by row, the launch's `HOME` is made empty before the rows, and no row writes
 * the account's own files or the client's system file.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {userInfo} from 'node:os';
import path from 'node:path';
import {invocationNotesOf} from '../../../tools/acceptance-clients.ts';
import {
  appendScript,
  closeWindow,
  connectionLog,
  connectionHelpers,
  connectedWithin,
  inWindow,
  isOpen,
  messagesSince,
  noHelperWithin,
  openWindow,
  recordLines,
  sshArguments,
  type RecordLine,
  userSettings,
  variable,
} from '../windows/harness.ts';

/** The question of the host pick. */
const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** The fixed rows of the host pick, after the listed hosts. */
const FIXED_ROWS = ['$(plus) Add New SSH Host...', 'Configure SSH Hosts...'];

/** A word shared by both questions of the configuration file pick. */
const FILE_QUESTION = 'SSH configuration file';

/** The client's system file, which the rows read but never change. */
const SYSTEM_FILE = '/etc/ssh/ssh_config';

/** The run's folder, the launch's `HOME` made empty before the rows, and the user file under it. */
const RUN_FOLDER = variable('HARNESS_RUN_FOLDER');
const HOME_FOLDER = path.join(RUN_FOLDER, 'home');
const USER_FILE = path.join(HOME_FOLDER, '.ssh', 'config');

/** The files the rows write, named as the card names them. */
const CFG_A = path.join(RUN_FOLDER, 'cfg-a');
const CFG_B = path.join(HOME_FOLDER, 'cfg-b');
const CFG_000 = path.join(RUN_FOLDER, 'cfg-000');
const CFG_C = path.join(RUN_FOLDER, 'cfg-c');
const CFG_D = path.join(RUN_FOLDER, 'cfg-d');
const CFG_E = path.join(RUN_FOLDER, 'cfg-e');
const CFG_F = path.join(RUN_FOLDER, 'cfg-f');
const CFG_LOOP = path.join(RUN_FOLDER, 'cfg-loop');
const CFG_LOOP_B = path.join(RUN_FOLDER, 'cfg-loop-b');
const CFG_CRLF = path.join(RUN_FOLDER, 'cfg-crlf');
const CFG_BOM = path.join(RUN_FOLDER, 'cfg-bom');
const CFG_BIN = path.join(RUN_FOLDER, 'cfg-bin');

/** The `Host harness` block's `Port` and `IdentityFile` values, from the run's ssh_config. */
function harnessOptions(): {port: string; identityFile: string} {
  const lines = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8').split(
    '\n',
  );
  let inBlock = false;
  const block: string[] = [];
  for (const line of lines) {
    if (!inBlock && /^\s*Host\s+harness(\s|$)/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^\s*Host\s/.test(line)) {
      break;
    }
    if (inBlock) {
      block.push(line);
    }
  }
  function option(name: string): string {
    const line = block.find(each => each.trim().startsWith(`${name} `));
    if (line === undefined) {
      return '';
    }
    return line.trim().split(/\s+/)[1] ?? '';
  }
  return {port: option('Port'), identityFile: option('IdentityFile')};
}

/** The block the rows write under `host`: the harness host's lines, under that name. */
function hostBlock(host: string): string {
  const {port, identityFile} = harnessOptions();
  return [
    `Host ${host}`,
    '  HostName 127.0.0.1',
    `  Port ${port}`,
    '  User harness',
    `  IdentityFile ${identityFile}`,
    '  IdentitiesOnly yes',
    '  BatchMode yes',
    '  StrictHostKeyChecking accept-new',
    `  UserKnownHostsFile ${path.join(RUN_FOLDER, 'known_hosts')}`,
    '',
  ].join('\n');
}

/**
 * The `Host` words the client's system file names, following its `Include`s breadth first as the product's reader
 * does, without `*`, `?` or `!`, each once, in first mention; empty when it names none.
 */
function systemHosts(): string[] {
  const words: string[] = [];
  function read(file: string, seen: Set<string>): void {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const line of text.split('\n')) {
      const host = /^\s*Host\s+(.*)$/i.exec(line)?.[1];
      if (host !== undefined) {
        for (const word of host.trim().split(/\s+/)) {
          if (!/[*?!]/.test(word) && !words.includes(word)) {
            words.push(word);
          }
        }
        continue;
      }
      const include = /^\s*Include\s+(.*)$/i.exec(line)?.[1];
      if (include !== undefined) {
        for (const included of includesOf(include.trim(), path.dirname(file))) {
          read(included, seen);
        }
      }
    }
  }
  read(SYSTEM_FILE, new Set());
  return words;
}

/**
 * The files an `Include` pattern names: its globs expanded against the including file's folder, or the path as
 * written when it names one file. A `*` spans no folder, as the client's include does.
 */
function includesOf(pattern: string, folder: string): string[] {
  const absolute = path.isAbsolute(pattern)
    ? pattern
    : path.join(folder, pattern);
  if (!/[?*]/.test(absolute)) {
    return [absolute];
  }
  const parts = absolute.split('/');
  let start = parts.length - 1;
  while (start > 0 && !/[?*]/.test(parts[start] ?? '')) {
    start -= 1;
  }
  const base = parts.slice(0, start).join('/');
  let names: string[];
  try {
    names = readdirSync(base === '' ? folder : base).sort();
  } catch {
    return [];
  }
  const shape = parts
    .slice(start)
    .join('/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  const matcher = new RegExp(`^${shape}$`);
  return names
    .filter(name => matcher.test(name))
    .map(name => path.join(base === '' ? folder : base, name));
}

/** Sets `remote.SSH.configFile` to `file`, or removes the key when `file` is empty. */
async function configFileSetting(file: string): Promise<void> {
  await userSettings(
    file === ''
      ? {'remote.SSH.configFile': undefined}
      : {'remote.SSH.configFile': file},
  );
}

/** The last line a surface wrote for the local window, or a failure naming the surface. */
function lastLine(surface: string): RecordLine {
  const line = recordLines(surface, 'local').at(-1);
  if (line === undefined) {
    throw new Error(`the local window wrote no ${surface} line`);
  }
  return line;
}

/** Runs a host pick in the local window, dismissed, and gives the record's line for it. */
async function hostPick(): Promise<RecordLine> {
  appendScript([
    {
      surface: 'hostPick',
      match: HOST_QUESTION,
      answer: 'dismiss',
      window: 'local',
    },
  ]);
  await inWindow('local', 'opensshremotes.openEmptyWindow');
  return lastLine('hostPick');
}

/** A dismissed host pick's items and the messages it showed. */
async function hostPickResult(): Promise<{
  items: string[] | undefined;
  messages: string[];
}> {
  const mark = recordLines().length;
  const line = await hostPick();
  return {items: line.items, messages: messagesSince(mark)};
}

/** Runs the configuration file pick in the local window with `answer` and gives the record's line for it. */
async function filePick(
  answer: 'dismiss' | {label: string},
): Promise<RecordLine> {
  appendScript([
    {surface: 'filePick', match: FILE_QUESTION, answer, window: 'local'},
  ]);
  await inWindow('local', 'opensshremotes.openConfigFile');
  return lastLine('filePick');
}

/** The expected results of `count` picks that list nothing: the fixed rows, no messages. */
function fixedOnly(count: number): Array<[string[] | undefined, string[]]> {
  const expected: Array<[string[] | undefined, string[]]> = [];
  for (let index = 0; index < count; index += 1) {
    expected.push([FIXED_ROWS, []]);
  }
  return expected;
}

/** The entries that dismiss a window's failure dialog and its pick of actions. */
function failureEntries(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

/**
 * Samples `sshArguments` every few milliseconds until `until` holds, and gives the distinct argvs seen: an `ssh`
 * process lives only as long as its connect, so a single reading after the dialog would miss it.
 */
async function sshArgumentsUntil(until: () => boolean): Promise<string[][]> {
  const seen: string[][] = [];
  const known: Set<string> = new Set<string>();
  async function collect(): Promise<void> {
    for (const argv of await sshArguments()) {
      const key = argv.join('\0');
      if (!known.has(key)) {
        known.add(key);
        seen.push(argv);
      }
    }
  }
  await collect();
  while (!until()) {
    await collect();
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await collect();
  return seen;
}

/** The file an argv hands `ssh` with `-F`, or nothing when it hands none. */
function fileOf(argv: string[]): string {
  const index = argv.indexOf('-F');
  if (index === -1) {
    return '';
  }
  return argv[index + 1] ?? '';
}

/** Whether any of `argvs` hands `ssh` the file `file`. */
function handsFile(argvs: string[][], file: string): boolean {
  return argvs.some(argv => fileOf(argv) === file);
}

/**
 * The argvs the launch's ssh recorder noted, in order: an invocation is its argument lines, ended by a blank one.
 * The recorder is on the launch's PATH, so every `ssh` the extension started is noted even when it ends in
 * milliseconds, too briefly for a /proc reading.
 */
function recordedInvocations(): string[][] {
  const notesFile = invocationNotesOf(RUN_FOLDER);
  if (!existsSync(notesFile)) {
    return [];
  }
  const argvs: string[][] = [];
  let current: string[] = [];
  for (const line of readFileSync(notesFile, 'utf8').split('\n')) {
    if (line === '') {
      if (current.length > 0) {
        argvs.push(current);
      }
      current = [];
    } else {
      current.push(line);
    }
  }
  return argvs;
}

/** The distinct argvs of `first` plus `second`, deduplicated by their joined text. */
function distinctArgvs(first: string[][], second: string[][]): string[][] {
  const seen: Set<string> = new Set<string>();
  const argvs: string[][] = [];
  for (const argv of [...first, ...second]) {
    const key = argv.join('\0');
    if (!seen.has(key)) {
      seen.add(key);
      argvs.push(argv);
    }
  }
  return argvs;
}

/**
 * Opens window `folder` on `alias` while sampling `sshArguments`, until the window's failure dialog is in the
 * record, and gives the dialog's line and the distinct argvs noted while the connect ran: the /proc samples and
 * the recorder's notes of the row.
 */
async function failingWindow(
  alias: string,
  folder: string,
): Promise<{dialog: RecordLine; argvs: string[][]}> {
  const mark = recordedInvocations().length;
  const collecting = sshArgumentsUntil(
    () => recordLines('failureDialog', folder).length > 0,
  );
  appendScript([...failureEntries(folder)]);
  await openWindow(alias, folder);
  const sampled = await collecting;
  const argvs = distinctArgvs(sampled, recordedInvocations().slice(mark));
  const dialog = recordLines('failureDialog', folder).at(-1);
  if (dialog === undefined) {
    throw new Error(`window ${folder} wrote no failure dialog line`);
  }
  return {dialog, argvs};
}

/** Closes `window` and waits for no connection helper of the run to run. */
async function endWindow(window: string): Promise<void> {
  await closeWindow(window);
  await noHelperWithin(60_000);
}

/** An entry of a folder snapshot: its name under the folder, its size and its mtime; a folder's name ends in `/`. */
interface TreeEntry {
  name: string;
  size: number;
  mtime: number;
}

/** A folder's entries, recursively, as names with sizes and mtimes, by name; an absent folder is empty. */
function treeOf(folder: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  if (!existsSync(folder)) {
    return entries;
  }
  function walk(prefix: string, here: string): void {
    for (const child of readdirSync(here)) {
      const next = path.join(here, child);
      const name = prefix === '' ? child : `${prefix}/${child}`;
      const stat = statSync(next);
      entries.push({name, size: stat.size, mtime: stat.mtimeMs});
      if (stat.isDirectory()) {
        walk(`${name}/`, next);
      }
    }
  }
  walk('', folder);
  return entries.sort((first, second) => (first.name < second.name ? -1 : 1));
}

/**
 * The `*.json` files under the run's user-data `User` folder, except the `settings.json` the rows write and the
 * editor's own state: `globalStorage/storage.json` and each workspace's `workspace.json`.
 */
function userJsonTree(): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const editorState =
    /^workspaceStorage\/[^/]+\/workspace\.json$|^globalStorage\/storage\.json$/;
  function walk(prefix: string, here: string): void {
    const names = existsSync(here) ? readdirSync(here) : [];
    for (const child of names) {
      const next = path.join(here, child);
      const name = prefix === '' ? child : `${prefix}/${child}`;
      const stat = statSync(next);
      if (stat.isDirectory()) {
        walk(name, next);
      } else if (
        child.endsWith('.json') &&
        name !== 'settings.json' &&
        !editorState.test(name)
      ) {
        entries.push({name, size: stat.size, mtime: stat.mtimeMs});
      }
    }
  }
  walk('', path.join(RUN_FOLDER, 'user-data', 'User'));
  return entries.sort((first, second) => (first.name < second.name ? -1 : 1));
}

describe('the configuration-file rows of F-2201 (card coverage-20, #142)', function () {
  this.timeout(300_000);

  /** The snapshot names AC-29 compares: the launch's `HOME`, the run's user settings, and the account's own `~/.ssh`. */
  let homeBefore: string[] = [];
  let jsonBefore: TreeEntry[] = [];
  let accountSshBefore: TreeEntry[] = [];

  before(async function () {
    this.timeout(120_000);
    rmSync(HOME_FOLDER, {recursive: true, force: true});
    mkdirSync(HOME_FOLDER, {recursive: true});
    mkdirSync(path.dirname(USER_FILE), {recursive: true});
    writeFileSync(USER_FILE, hostBlock('onlydefault'));
    await noHelperWithin(60_000);
    homeBefore = treeOf(HOME_FOLDER).map(entry => entry.name);
    jsonBefore = userJsonTree();
    accountSshBefore = treeOf(path.join(userInfo().homedir, '.ssh'));
  });

  after(async function () {
    this.timeout(120_000);
    for (const window of [
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
      'c9',
      'c10',
      'c11',
      'c13',
      'c14',
      'c15',
      'c16',
      'c17',
      'c18',
      'c19',
    ]) {
      if (isOpen(window)) {
        await closeWindow(window);
      }
    }
    await noHelperWithin(60_000);
  });

  it('F-2201 AC-3: with no user file, the pick lists the system hosts and no message appears', async () => {
    rmSync(USER_FILE, {recursive: true, force: true});
    await configFileSetting('');
    const result = await hostPickResult();
    deepStrictEqual(
      [result.items, result.messages],
      [[...systemHosts(), ...FIXED_ROWS], []],
    );
  });

  it('F-2201 AC-42: with the user file a folder, then a mode 000 file, the pick lists the system hosts and no message appears', async () => {
    rmSync(USER_FILE, {force: true});
    mkdirSync(USER_FILE, {recursive: true});
    const asFolder = await hostPickResult();
    rmSync(USER_FILE, {recursive: true});
    writeFileSync(USER_FILE, hostBlock('onlydefault'));
    chmodSync(USER_FILE, 0);
    const asMode000 = await hostPickResult();
    rmSync(USER_FILE);
    writeFileSync(USER_FILE, hostBlock('onlydefault'));
    const expected = [...systemHosts(), ...FIXED_ROWS];
    deepStrictEqual(
      [asFolder.items, asFolder.messages, asMode000.items, asMode000.messages],
      [expected, [], expected, []],
    );
  });

  it('F-2201 AC-5: with no setting, the configuration file pick offers the user file, the system file, Settings and Help', async () => {
    const line = await filePick('dismiss');
    deepStrictEqual(
      [line.question, line.items],
      [
        'Select SSH configuration file to update',
        [USER_FILE, SYSTEM_FILE, 'Settings', 'Help'],
      ],
    );
  });

  it('F-2201 AC-9: with a setting, the configuration file pick offers the setting as written, Settings and Help', async () => {
    writeFileSync(CFG_A, hostBlock('cfghost'));
    await configFileSetting(CFG_A);
    const line = await filePick('dismiss');
    deepStrictEqual(
      [line.question, line.items],
      ['Edit custom SSH configuration file', [CFG_A, 'Settings', 'Help']],
    );
  });

  it('F-2201 AC-43: a whitespace-only setting is the edit placeholder', async () => {
    await configFileSetting('   ');
    const line = await filePick('dismiss');
    strictEqual(line.question, 'Edit custom SSH configuration file');
  });

  it('F-2201 AC-12: a ~/ setting lists its hosts and a window on one connects', async () => {
    writeFileSync(CFG_B, hostBlock('cfghost'));
    await configFileSetting('~/cfg-b');
    const line = await hostPick();
    await openWindow('cfghost', 'c1');
    await connectedWithin('c1', 60_000);
    await endWindow('c1');
    deepStrictEqual(line.items, ['cfghost', ...FIXED_ROWS]);
  });

  it('F-2201 AC-40: picking the ~/ row opens the expanded file and creates nothing named ~', async () => {
    const line = await filePick({label: '~/cfg-b'});
    deepStrictEqual(
      [
        line.items?.[0],
        existsSync(path.join(HOME_FOLDER, '~')),
        existsSync(path.join(RUN_FOLDER, '~')),
        existsSync(path.join(process.cwd(), '~')),
      ],
      ['~/cfg-b', false, false, false],
    );
  });

  it('F-2201 AC-13: a setting that is not an absolute file lists no hosts, in each bad form, and no message appears', async () => {
    writeFileSync(CFG_000, hostBlock('cfghost'));
    chmodSync(CFG_000, 0);
    const results = [
      await (async () => {
        await configFileSetting('cfg-b');
        return hostPickResult();
      })(),
      await (async () => {
        await configFileSetting('~');
        return hostPickResult();
      })(),
      await (async () => {
        await configFileSetting('${env:HOME}/cfg-b');
        return hostPickResult();
      })(),
      await (async () => {
        await configFileSetting('$HOME/cfg-b');
        return hostPickResult();
      })(),
      await (async () => {
        await configFileSetting('   ');
        return hostPickResult();
      })(),
      await (async () => {
        await configFileSetting(path.join(RUN_FOLDER, 'missing'));
        return hostPickResult();
      })(),
      await (async () => {
        await configFileSetting(RUN_FOLDER);
        return hostPickResult();
      })(),
      await (async () => {
        await configFileSetting(CFG_000);
        return hostPickResult();
      })(),
    ];
    deepStrictEqual(
      results.map(result => [result.items, result.messages]),
      fixedOnly(results.length),
    );
  });

  it('F-2201 AC-28: a missing file is handed to ssh, the connect fails without a detail, and no default file is read', async () => {
    await configFileSetting(path.join(RUN_FOLDER, 'missing'));
    const missingFile = path.join(RUN_FOLDER, 'missing');
    const {dialog, argvs} = await failingWindow('cfghost', 'c2');
    await endWindow('c2');
    deepStrictEqual(
      [dialog.question, handsFile(argvs, missingFile)],
      ['Could not establish connection to "cfghost".', true],
    );
  });

  it('F-2201 AC-35: a relative setting fails the connect before ssh is started, and the log names the setting', async () => {
    await configFileSetting('cfg-b');
    const mark = connectionLog().length;
    const {dialog, argvs} = await failingWindow('cfghost', 'c13');
    await endWindow('c13');
    const lines = connectionLog().slice(mark);
    deepStrictEqual(
      [
        dialog.question,
        argvs.length,
        lines.includes(
          'remote.SSH.configFile is not an absolute path: "cfg-b"',
        ),
        lines.some(line => line.startsWith('Checking ssh client:')),
      ],
      ['Could not establish connection to "cfghost".', 0, true, false],
    );
  });

  it('F-2201 AC-35: a $HOME/ setting fails the connect before ssh is started, and the log names the setting', async () => {
    await configFileSetting('$HOME/cfg-b');
    const mark = connectionLog().length;
    const {dialog, argvs} = await failingWindow('cfghost', 'c14');
    await endWindow('c14');
    const lines = connectionLog().slice(mark);
    deepStrictEqual(
      [
        dialog.question,
        argvs.length,
        lines.includes(
          'remote.SSH.configFile is not an absolute path: "$HOME/cfg-b"',
        ),
        lines.some(line => line.startsWith('Checking ssh client:')),
      ],
      ['Could not establish connection to "cfghost".', 0, true, false],
    );
  });

  it('F-2201 AC-35: a ${env:HOME}/ setting fails the connect before ssh is started, and the log names the setting', async () => {
    await configFileSetting('${env:HOME}/cfg-b');
    const mark = connectionLog().length;
    const {dialog, argvs} = await failingWindow('cfghost', 'c15');
    await endWindow('c15');
    const lines = connectionLog().slice(mark);
    deepStrictEqual(
      [
        dialog.question,
        argvs.length,
        lines.includes(
          'remote.SSH.configFile is not an absolute path: "${env:HOME}/cfg-b"',
        ),
        lines.some(line => line.startsWith('Checking ssh client:')),
      ],
      ['Could not establish connection to "cfghost".', 0, true, false],
    );
  });

  it('F-2201 AC-35: a folder as the setting reaches ssh, which cannot resolve the host', async () => {
    await configFileSetting(RUN_FOLDER);
    const {dialog} = await failingWindow('cfghost', 'c16');
    await endWindow('c16');
    strictEqual(
      dialog.question,
      'Could not establish connection to "cfghost": Could not resolve hostname.',
    );
  });

  it('F-2201 AC-35: ~ alone expands to a folder and reaches ssh, which cannot resolve the host', async () => {
    await configFileSetting('~');
    const {dialog} = await failingWindow('cfghost', 'c17');
    await endWindow('c17');
    strictEqual(
      dialog.question,
      'Could not establish connection to "cfghost": Could not resolve hostname.',
    );
  });

  it('F-2201 AC-35: a mode 000 file fails the connect with Permission denied', async () => {
    if (typeof process.getuid !== 'function' || process.getuid() === 0) {
      throw new Error('the mode 000 rows need a non-root account');
    }
    await configFileSetting(CFG_000);
    const {dialog} = await failingWindow('cfghost', 'c18');
    await endWindow('c18');
    strictEqual(
      dialog.question,
      'Could not establish connection to "cfghost": Permission denied.',
    );
  });

  it('F-2201 AC-44: a host only in the default files fails when the setting names a file without it', async () => {
    await configFileSetting(CFG_A);
    const {dialog, argvs} = await failingWindow('onlydefault', 'c3');
    await endWindow('c3');
    deepStrictEqual(
      [dialog.question, handsFile(argvs, CFG_A)],
      [
        'Could not establish connection to "onlydefault": Could not resolve hostname.',
        true,
      ],
    );
  });

  it("F-2201 AC-31: without a setting the pick lists the user file's host, and ssh started without -F cannot reach it", async () => {
    await configFileSetting('');
    const line = await hostPick();
    const {dialog, argvs} = await failingWindow('onlydefault', 'c10');
    await endWindow('c10');
    deepStrictEqual(
      [
        line.items,
        dialog.question,
        argvs.length > 0,
        argvs.some(argv => fileOf(argv) !== ''),
      ],
      [
        ['onlydefault', ...systemHosts(), ...FIXED_ROWS],
        'Could not establish connection to "onlydefault": Could not resolve hostname.',
        true,
        false,
      ],
    );
  });

  it("F-2201 AC-10: a window on a host only the setting's file defines connects, and the log names the file", async () => {
    await configFileSetting(CFG_A);
    const mark = connectionLog().length;
    await openWindow('cfghost', 'c11');
    await connectedWithin('c11', 60_000);
    await endWindow('c11');
    deepStrictEqual(
      connectionLog()
        .slice(mark)
        .includes(`SSH configuration file in use: ${CFG_A}`),
      true,
    );
  });

  it('F-2201 AC-18: a host with IgnoreUnknown ahead of its unknown keyword is listed and connects', async () => {
    writeFileSync(
      CFG_C,
      hostBlock('cfghost').replace(
        'Host cfghost',
        'Host cfghost\n  IgnoreUnknown Foo\n  Foo bar',
      ),
    );
    await configFileSetting(CFG_C);
    const result = await hostPickResult();
    await openWindow('cfghost', 'c4');
    await connectedWithin('c4', 60_000);
    await endWindow('c4');
    deepStrictEqual(
      [result.items, result.messages],
      [['cfghost', ...FIXED_ROWS], []],
    );
  });

  it("F-2201 AC-26: a keyword ssh rejects fails the connect, and the log holds ssh's complaint with the line", async () => {
    writeFileSync(
      CFG_D,
      hostBlock('cfghost').replace('Host cfghost', 'Host cfghost\n  Bogus yes'),
    );
    await configFileSetting(CFG_D);
    const mark = connectionLog().length;
    const {dialog} = await failingWindow('cfghost', 'c5');
    await endWindow('c5');
    deepStrictEqual(
      [
        dialog.question,
        connectionLog()
          .slice(mark)
          .some(line => line.includes(CFG_D) && /line \d+/.test(line)),
      ],
      ['Could not establish connection to "cfghost".', true],
    );
  });

  it('F-2201 AC-34: an Include of a file ssh rejects fails the connect, and the log names the included file', async () => {
    writeFileSync(CFG_E, `Include ${CFG_D}\n${hostBlock('cfghost')}`);
    await configFileSetting(CFG_E);
    const mark = connectionLog().length;
    const {dialog} = await failingWindow('cfghost', 'c6');
    await endWindow('c6');
    deepStrictEqual(
      [
        dialog.question,
        connectionLog()
          .slice(mark)
          .some(line => line.includes(CFG_D)),
      ],
      ['Could not establish connection to "cfghost".', true],
    );
  });

  it('F-2201 AC-41: a custom file with mode 0666 still connects', async () => {
    writeFileSync(CFG_F, hostBlock('cfghost'));
    chmodSync(CFG_F, 0o666);
    await configFileSetting(CFG_F);
    const mark = connectionLog().length;
    await openWindow('cfghost', 'c7');
    await connectedWithin('c7', 60_000);
    await endWindow('c7');
    deepStrictEqual(
      connectionLog()
        .slice(mark)
        .includes(`SSH configuration file in use: ${CFG_F}`),
      true,
    );
  });

  it('F-2201 AC-38: an Include loop lists each host once, CRLF and BOM files list their host, and binary bytes list none', async () => {
    writeFileSync(CFG_LOOP, `Include ${CFG_LOOP_B}\nHost loopa\n`);
    writeFileSync(CFG_LOOP_B, `Include ${CFG_LOOP}\nHost loopb\n`);
    writeFileSync(CFG_CRLF, hostBlock('cfghost').split('\n').join('\r\n'));
    writeFileSync(CFG_BOM, `\uFEFF${hostBlock('cfghost')}`);
    writeFileSync(
      CFG_BIN,
      Buffer.concat([
        Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
        Buffer.from(hostBlock('cfghost'), 'utf8'),
      ]),
    );
    async function pickOf(
      file: string,
    ): Promise<{items: string[] | undefined; messages: string[]}> {
      await configFileSetting(file);
      return hostPickResult();
    }
    const loop = await pickOf(CFG_LOOP);
    const crlf = await pickOf(CFG_CRLF);
    const bomPick = await pickOf(CFG_BOM);
    const binary = await pickOf(CFG_BIN);
    deepStrictEqual(
      [
        [...(loop.items ?? [])].slice(0, -2).sort(),
        crlf.items,
        bomPick.items,
        binary.items,
        loop.messages,
        crlf.messages,
        bomPick.messages,
        binary.messages,
      ],
      [
        ['loopa', 'loopb'],
        ['cfghost', ...FIXED_ROWS],
        ['cfghost', ...FIXED_ROWS],
        FIXED_ROWS,
        [],
        [],
        [],
        [],
      ],
    );
  });

  it('F-2201 AC-38: a window on the CRLF file connects', async () => {
    await configFileSetting(CFG_CRLF);
    const mark = connectionLog().length;
    await openWindow('cfghost', 'c19');
    await connectedWithin('c19', 60_000);
    await endWindow('c19');
    deepStrictEqual(
      connectionLog()
        .slice(mark)
        .includes(`SSH configuration file in use: ${CFG_CRLF}`),
      true,
    );
  });

  it('F-2201 AC-36: a second window on the host reuses the running helper and its configuration', async () => {
    await configFileSetting(CFG_A);
    await openWindow('cfghost', 'c8');
    await connectedWithin('c8', 60_000);
    writeFileSync(
      CFG_A,
      hostBlock('cfghost').replace('HostName 127.0.0.1', 'HostName 192.0.2.1'),
    );
    await openWindow('cfghost', 'c9');
    await connectedWithin('c9', 60_000);
    const helpers = await connectionHelpers();
    await closeWindow('c9');
    await closeWindow('c8');
    await noHelperWithin(60_000);
    deepStrictEqual(helpers.length, 1);
  });

  it("F-2201 AC-29: the reading wrote no configuration file and no setting, and the account's own files are untouched", () => {
    const homeAfter = treeOf(HOME_FOLDER).map(entry => entry.name);
    const jsonAfter = userJsonTree();
    const accountSshAfter = treeOf(path.join(userInfo().homedir, '.ssh'));
    deepStrictEqual(
      [homeAfter, jsonAfter, accountSshAfter],
      [[...homeBefore, 'cfg-b'].sort(), jsonBefore, accountSshBefore],
    );
  });
});
