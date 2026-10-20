import {deepStrictEqual} from 'node:assert';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {
  closeWindow,
  connectionLog,
  cutHostNetwork,
  inWindow,
  onHost,
  readUserSettings,
  remoteSshActive,
  restoreHostNetwork,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  openConnected,
  openLocalWindow,
  perWindowMode,
  setting,
} from '../windows/maintenance.ts';
import {
  dialogOf,
  editorTabs,
  hasStatusItem,
  notificationCentre,
  pageCount,
  paletteRows,
  paletteRun,
  quickPickOf,
  statusItem,
  windowTitle,
} from '../windows/renderer.ts';
import {
  installBrowser,
  openedUrls,
  serverPortOf,
  setWebAccess,
} from '../windows/web-ui-support.ts';

/** The label of the command in the Command Palette. */
const COMMAND = 'Remote-SSH: Open Web UI';

/** The host's home folder, where the rows write the settings of the remote side. */
const HOME = '/home/harness';

/** Whether the Command Palette of window `name` lists Open Web UI. */
async function listed(name: string): Promise<boolean> {
  return (await paletteRows(name, 'Open Web UI')).includes(COMMAND);
}

/** Waits up to `milliseconds` for the palette of `name` to list Open Web UI or not, and gives what it listed last. */
async function listedWithin(
  name: string,
  expected: boolean,
  milliseconds = 10_000,
): Promise<boolean> {
  let last = !expected;
  await waitFor(
    `Open Web UI to be ${expected ? '' : 'not '}listed in ${name}`,
    async () => {
      last = await listed(name);
      return last === expected;
    },
    milliseconds,
  ).catch(() => undefined);
  return last;
}

/** What a window shows of itself that running Open Web UI must not change. */
async function surfaceOf(name: string) {
  return {
    notifications: await notificationCentre(name),
    dialog: await dialogOf(name),
    quickPick: await quickPickOf(name),
    tabs: await editorTabs(name),
    pages: await pageCount(),
    ports: await hasStatusItem(name, 'status.forwardedPorts'),
    title: await windowTitle(name),
    indicator: (await statusItem(name, 'status.host')).text,
  };
}

/** The processes and the listening ports of the host, without the processes a command of the row itself starts. */
async function hostState(): Promise<{processes: string[]; ports: string[]}> {
  const processes = (await onHost('ps', '-eo', 'comm'))
    .split('\n')
    .map(line => line.trim())
    .filter(
      line => line !== '' && !['COMMAND', 'ps', 'sh', 'sleep'].includes(line),
    );
  const listening = await onHost(
    'sh',
    '-c',
    'ss -ltn 2>/dev/null || netstat -ltn',
  );
  const ports = listening
    .split('\n')
    .flatMap(line => /:(\d+)\s/.exec(line)?.[1] ?? [])
    .sort();
  return {
    processes: [...new Set(processes)].sort(),
    ports: [...new Set(ports)],
  };
}

/** Every file name under `folder`, relative to it, without those whose path holds `skip`. */
function namesUnder(folder: string, skip: RegExp): string[] {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, {recursive: true, encoding: 'utf8'})
    .filter(name => !skip.test(name))
    .sort();
}

/** The length of our entry in the editor's stored state, or nothing when it has none. */
function stateLength(): number | undefined {
  const file = path.join(userFolder(), 'globalStorage', 'state.vscdb');
  if (!existsSync(file)) {
    return undefined;
  }
  const database = new DatabaseSync(file, {readOnly: true});
  try {
    const entry = database
      .prepare('SELECT value FROM ItemTable WHERE key = ?')
      .get('remote-oss.remote-ssh') as {value?: string} | undefined;
    return entry?.value?.length;
  } finally {
    database.close();
  }
}

/** What running Open Web UI must leave as it is, on the client and on the host. */
async function storedOf() {
  return {
    settings: readFileSync(path.join(userFolder(), 'settings.json'), 'utf8'),
    keybindings: existsSync(path.join(userFolder(), 'keybindings.json'))
      ? readFileSync(path.join(userFolder(), 'keybindings.json'), 'utf8')
      : null,
    stateLength: stateLength(),
    sshFiles: namesUnder(path.join(process.env.HOME ?? '', '.ssh'), /^$/),
    user: namesUnder(userFolder(), /-(wal|shm|journal)$/),
    host: (
      await onHost(
        'find',
        HOME,
        '-not',
        '-path',
        '*/logs*',
        '-not',
        '-path',
        '*/.vscode-server*',
        '-not',
        '-path',
        '*server*/data*',
      )
    )
      .split('\n')
      .sort(),
    scratch: (await onHost('ls', '-A', '/tmp')).split('\n').sort(),
  };
}

/** The run's user data `User` folder. */
function userFolder(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'user-data', 'User');
}

describe('Open Web UI (card coverage-48)', function () {
  this.timeout(900_000);

  /** The port of the server of each window, read from the log when it connected. */
  const ports = new Map<string, number | undefined>();
  let saved: string | undefined;

  /** Opens window `name` on the host, connected, and notes the server's port. */
  async function connectedWindow(name: string): Promise<void> {
    await openConnected(name);
    ports.set(name, serverPortOf(connectionLog()));
  }

  /** The address Open Web UI opens for the window `name`. */
  function addressOf(name: string): string {
    return `http://localhost:${String(ports.get(name))}/`;
  }

  before(async () => {
    saved = readUserSettings();
    installBrowser();
    await closeAllButLocal();
    await connectedWindow('wu1');
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    await userSettings({});
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2509 AC-2 (listed): in a connected window with the key on, Open Web UI is the first row for its name', async () => {
    await setWebAccess(true);
    deepStrictEqual((await paletteRows('wu1', 'Open Web UI'))[0], COMMAND);
  });

  it('F-2509 AC-3 (unlisted): with the key absent, false, 0, the empty text or null, Open Web UI is not listed', async () => {
    const results: boolean[] = [];
    for (const value of [undefined, false, 0, '', null]) {
      await setWebAccess(value);
      results.push(await listed('wu1'));
    }
    deepStrictEqual(results, [false, false, false, false, false]);
  });

  it('F-2509 AC-4 (listed-truthy): with the key the text true or yes, the number 1 or an object, Open Web UI is listed', async () => {
    const results: boolean[] = [];
    for (const value of ['true', 'yes', 1, {}]) {
      await setWebAccess(value);
      results.push(await listed('wu1'));
    }
    deepStrictEqual(results, [true, true, true, true]);
  });

  it('F-2509 AC-5 (follows): adding the key lists the command and removing it unlists it, each within 10 s and with no reload', async () => {
    await setWebAccess(undefined);
    const before = await listed('wu1');
    await setWebAccess(true);
    const added = await listedWithin('wu1', true);
    await setWebAccess(undefined);
    const removed = await listedWithin('wu1', false);
    deepStrictEqual([before, added, removed], [false, true, false]);
  });

  it('F-2509 AC-6 (remote-settings): the key only in the remote folder’s settings, or only in the remote machine settings, lists the command', async () => {
    await setWebAccess(undefined);
    const folderSettings = `${HOME}/wu1/.vscode/settings.json`;
    const machineSettings = `${DATA_FOLDER}/data/Machine/settings.json`;
    const json = '{"remote.SSH.enableWebAccess": true}';
    try {
      await onHost('mkdir', '-p', path.posix.dirname(folderSettings));
      await onHost('sh', '-c', `printf '%s' '${json}' > '${folderSettings}'`);
      const inFolder = await listedWithin('wu1', true, 20_000);
      await onHost('rm', '-f', folderSettings);
      const gone = await listedWithin('wu1', false, 20_000);
      await onHost('mkdir', '-p', path.posix.dirname(machineSettings));
      await onHost('sh', '-c', `printf '%s' '${json}' > '${machineSettings}'`);
      const inMachine = await listedWithin('wu1', true, 20_000);
      deepStrictEqual([inFolder, gone, inMachine], [true, false, true]);
    } finally {
      await onHost('rm', '-f', folderSettings, machineSettings);
    }
  });

  it('F-2509 AC-7 (local-window): in a local window with the key on, Open Web UI is not listed', async () => {
    await setWebAccess(true);
    deepStrictEqual(await listed('local'), false);
  });

  it('F-2509 AC-9 (opens): running it opens http://localhost:<port>/ in the browser and changes nothing the window shows', async () => {
    await setWebAccess(true);
    const before = await surfaceOf('wu1');
    const opened = openedUrls().length;
    await paletteRun('wu1', 'Open Web UI');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [openedUrls().slice(opened), await surfaceOf('wu1')],
      [[addressOf('wu1')], before],
    );
  });

  it('F-2509 AC-10 (no-side-effects): running it starts no process, opens no port and writes no log line', async () => {
    await userSettings({'remote.SSH.logLevel': 'trace'});
    await setWebAccess(true);
    const before = await hostState();
    const lines = connectionLog().length;
    await paletteRun('wu1', 'Open Web UI');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [await hostState(), connectionLog().slice(lines)],
      [before, []],
    );
  });

  it('F-2509 AC-11 (twice): running it twice opens the same address twice and nothing else', async () => {
    await setWebAccess(true);
    const before = await surfaceOf('wu1');
    const opened = openedUrls().length;
    await paletteRun('wu1', 'Open Web UI');
    await new Promise(resolve => setTimeout(resolve, 1500));
    await paletteRun('wu1', 'Open Web UI');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [openedUrls().slice(opened), await surfaceOf('wu1')],
      [[addressOf('wu1'), addressOf('wu1')], before],
    );
  });

  it('F-2509 AC-12 (arguments): an object or a text passed to the command does not change the address', async () => {
    await setWebAccess(true);
    const opened = openedUrls().length;
    await inWindow('wu1', 'opensshremotes.openWebUI', {anything: 1});
    await inWindow('wu1', 'opensshremotes.openWebUI', 'text');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(openedUrls().slice(opened), [
      addressOf('wu1'),
      addressOf('wu1'),
    ]);
  });

  it('F-2509 AC-13 (other-windows): in a local window, and in an SSH window with the key unset, it changes no settings or keybindings and the window still answers', async () => {
    await setWebAccess(undefined);
    const files = [
      path.join(userFolder(), 'settings.json'),
      path.join(userFolder(), 'keybindings.json'),
    ].map(file => (existsSync(file) ? readFileSync(file, 'utf8') : null));
    const opened = openedUrls().length;
    const notifications = [
      await notificationCentre('local'),
      await notificationCentre('wu1'),
    ];
    await inWindow('local', 'opensshremotes.openWebUI');
    const afterLocal = openedUrls().length;
    await inWindow('wu1', 'opensshremotes.openWebUI');
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      [
        afterLocal - opened,
        openedUrls().slice(opened),
        [
          path.join(userFolder(), 'settings.json'),
          path.join(userFolder(), 'keybindings.json'),
        ].map(file => (existsSync(file) ? readFileSync(file, 'utf8') : null)),
        [await notificationCentre('local'), await notificationCentre('wu1')],
        [
          (await windowState('local')).remoteName,
          (await windowState('wu1')).remoteName,
        ],
      ],
      [0, [addressOf('wu1')], files, notifications, [null, 'ssh-remote']],
    );
  });

  it('F-2509 AC-16 (fresh-window): invoking it in a local window where Remote - SSH is not active activates it and shows nothing', async () => {
    await openLocalWindow('wu16', 'web-ui-folders');
    const opened = openedUrls().length;
    const before = [await remoteSshActive('wu16'), await surfaceOf('wu16')];
    await inWindow('wu16', 'opensshremotes.openWebUI');
    const after = [await remoteSshActive('wu16'), await surfaceOf('wu16')];
    await closeWindow('wu16');
    deepStrictEqual(
      [before[0], after[0], after[1], openedUrls().length - opened],
      [false, true, before[1], 0],
    );
  });

  it('F-2509 AC-17 (set-first): with the key set before the window connects, it is listed once connected and runs as ever', async () => {
    await setWebAccess(true);
    await connectedWindow('wu17');
    const opened = openedUrls().length;
    const rows = await listed('wu17');
    await paletteRun('wu17', 'Open Web UI');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const urls = openedUrls().slice(opened);
    await closeWindow('wu17');
    deepStrictEqual([rows, urls], [true, [addressOf('wu17')]]);
  });

  it('F-2509 AC-18 (connections): with the local server off, and then with the exec server off too, it opens the address of that connection’s port', async () => {
    await setWebAccess(true);
    const seen: boolean[] = [];
    try {
      await perWindowMode(true);
      for (const name of ['wu18a', 'wu18b']) {
        await connectedWindow(name);
        const opened = openedUrls().length;
        await paletteRun(name, 'Open Web UI');
        await new Promise(resolve => setTimeout(resolve, 3000));
        seen.push(openedUrls().slice(opened).join() === addressOf(name));
        await closeWindow(name);
        await setting('remote.SSH.useExecServer', false);
      }
    } finally {
      await setting('remote.SSH.useExecServer', undefined);
      await perWindowMode(false);
    }
    deepStrictEqual(seen, [true, true]);
  });

  it('F-2509 AC-19 (socket): with the server on a socket it opens no address', async () => {
    await setWebAccess(true);
    const urls: string[] = [];
    try {
      await perWindowMode(true);
      await setting('remote.SSH.remoteServerListenOnSocket', true);
      await connectedWindow('wu19');
      const opened = openedUrls().length;
      await paletteRun('wu19', 'Open Web UI');
      await new Promise(resolve => setTimeout(resolve, 3000));
      urls.push(...openedUrls().slice(opened));
      await closeWindow('wu19');
    } finally {
      await setting('remote.SSH.remoteServerListenOnSocket', undefined);
      await perWindowMode(false);
    }
    deepStrictEqual(urls, []);
  });

  it('F-2509 AC-21 (nothing-written): running it changes no settings, keybindings, stored state or file of the client or the host', async () => {
    await setWebAccess(true);
    const before = await storedOf();
    await paletteRun('wu1', 'Open Web UI');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(await storedOf(), before);
  });

  it('F-2509 AC-8, AC-13 (reconnecting): while the connection is lost it is not listed and running it opens nothing, and it is listed again once the connection is back', async () => {
    await setWebAccess(true);
    const opened = openedUrls().length;
    const files = readFileSync(
      path.join(userFolder(), 'settings.json'),
      'utf8',
    );
    let during: [boolean, number, string, string | null] | undefined;
    cutHostNetwork();
    try {
      await waitFor(
        'the indicator of wu1 to read reconnecting',
        async () =>
          /reconnect/i.test((await statusItem('wu1', 'status.host')).text),
        120_000,
      );
      const shown = await listed('wu1');
      await inWindow('wu1', 'opensshremotes.openWebUI');
      await new Promise(resolve => setTimeout(resolve, 2000));
      during = [
        shown,
        openedUrls().length - opened,
        readFileSync(path.join(userFolder(), 'settings.json'), 'utf8'),
        (await windowState('wu1')).remoteName,
      ];
    } finally {
      restoreHostNetwork();
    }
    await waitFor(
      'wu1 to read connected again',
      async () =>
        !/reconnect/i.test((await statusItem('wu1', 'status.host')).text),
      120_000,
    );
    deepStrictEqual(
      [during, await listedWithin('wu1', true, 60_000)],
      [[false, 0, files, 'ssh-remote'], true],
    );
  });
});
