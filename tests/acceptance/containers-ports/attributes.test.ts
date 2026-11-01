import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  devContainersOf,
  listenIn,
  readUserSettings,
  reopenInContainer,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {dialogOf, notificationCentre} from '../windows/renderer.ts';
import {
  editConfiguration,
  ensureListening,
  folderOf,
  freePort,
  listenInTerminal,
  listeningPorts,
  portsOf,
  portsWindows,
  reloaded,
  rowsWhen,
  showPorts,
} from './ports-support.ts';

const execFileAsync = promisify(execFile);

/** The rows' Port column once the view shows `count` rows, or whatever it shows after the wait. */
async function portColumn(window: string, count: number): Promise<string[]> {
  await showPorts(window);
  return portsOf(await rowsWhen(window, shown => shown.length >= count)).sort();
}

describe('the port attributes of the configuration (card containers-73)', function () {
  this.timeout(900_000);
  const {connectedWith} = portsWindows();

  it('F-1101 AC-2 (label): a label on a declared port is the row from the connect, and a listener changes the process, not the label', async () => {
    const port = await freePort();
    const window = await connectedWith('c73-ac2', {
      forwardPorts: [port],
      portsAttributes: {
        [String(port)]: {label: 'Application', onAutoForward: 'notify'},
      },
    });
    const before = await portColumn(window, 1);
    const [containerId = ''] = await devContainersOf(folderOf('c73-ac2'));
    const stop = await listenIn(containerId, port);
    try {
      await rowsWhen(window, shown =>
        shown.some(each => each.runningProcess !== ''),
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      const rows = await rowsWhen(window, () => true);
      deepStrictEqual(
        [before, portsOf(rows), rows.some(each => each.runningProcess !== '')],
        [
          [`Application (${String(port)})`],
          [`Application (${String(port)})`],
          true,
        ],
      );
    } finally {
      await stop();
    }
  });

  it('F-1101 AC-10 (range): a port inside a range key takes the range label', async () => {
    const port = await freePort();
    const window = await connectedWith('c73-ac10', {
      forwardPorts: [port],
      portsAttributes: {
        [`${String(port - 5)}-${String(port + 5)}`]: {label: 'Ranged'},
      },
    });
    deepStrictEqual(await portColumn(window, 1), [`Ranged (${String(port)})`]);
  });

  it('F-1101 AC-17 (exact-wins): an exact key wins over a range that holds the port', async () => {
    const port = await freePort();
    const window = await connectedWith('c73-ac17', {
      forwardPorts: [port],
      portsAttributes: {
        [String(port)]: {label: 'Exact'},
        [`${String(port - 5)}-${String(port + 5)}`]: {label: 'Ranged'},
      },
    });
    deepStrictEqual(await portColumn(window, 1), [`Exact (${String(port)})`]);
  });

  /** The Port column of `window`'s one row once a process shows on it, read again 3 s later so that a late change counts. */
  async function columnWithProcess(
    window: string,
    port: number,
    name: string,
  ): Promise<string[]> {
    await showPorts(window);
    const [containerId = ''] = await devContainersOf(folderOf(name));
    await listenIn(containerId, port);
    const seen = await rowsWhen(window, shown =>
      shown.some(each => each.runningProcess !== ''),
    );
    if (!seen.some(each => each.runningProcess !== '')) {
      throw new Error(`no row showed a process: ${JSON.stringify(seen)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    return portsOf(await rowsWhen(window, () => true)).sort();
  }

  it('F-1101 AC-21 (overlap-ranges): of two overlapping ranges the lower start wins in either order, before and after a process starts', async () => {
    const port = await freePort();
    const lower = `${String(port - 10)}-${String(port + 10)}`;
    const higher = `${String(port - 3)}-${String(port + 3)}`;
    const first = await connectedWith('c73-ac21a', {
      forwardPorts: [port],
      portsAttributes: {[lower]: {label: 'Lower'}, [higher]: {label: 'Higher'}},
    });
    const firstBefore = await portColumn(first, 1);
    const second = await connectedWith('c73-ac21b', {
      forwardPorts: [port],
      portsAttributes: {[higher]: {label: 'Higher'}, [lower]: {label: 'Lower'}},
    });
    const secondBefore = await portColumn(second, 1);
    deepStrictEqual(
      [
        [firstBefore, await columnWithProcess(first, port, 'c73-ac21a')],
        [secondBefore, await columnWithProcess(second, port, 'c73-ac21b')],
      ],
      [
        [[`Lower (${String(port)})`], [`Lower (${String(port)})`]],
        [[`Lower (${String(port)})`], [`Lower (${String(port)})`]],
      ],
    );
  });

  it('F-1101 AC-21 (range-and-regex): a range key’s label wins over a regex key in either order, and keeps winning once the process matches the regex', async () => {
    const port = await freePort();
    const range = `${String(port - 5)}-${String(port + 5)}`;
    const first = await connectedWith('c73-ac21e', {
      forwardPorts: [port],
      portsAttributes: {
        [range]: {label: 'Ranged'},
        'nc -lk': {label: 'Regexed'},
      },
    });
    const firstBefore = await portColumn(first, 1);
    const second = await connectedWith('c73-ac21f', {
      forwardPorts: [port],
      portsAttributes: {
        'nc -lk': {label: 'Regexed'},
        [range]: {label: 'Ranged'},
      },
    });
    const secondBefore = await portColumn(second, 1);
    deepStrictEqual(
      [
        [firstBefore, await columnWithProcess(first, port, 'c73-ac21e')],
        [secondBefore, await columnWithProcess(second, port, 'c73-ac21f')],
      ],
      [
        [[`Ranged (${String(port)})`], [`Ranged (${String(port)})`]],
        [[`Ranged (${String(port)})`], [`Ranged (${String(port)})`]],
      ],
    );
  });

  it('F-1101 AC-33 (machine-settings): the container user’s machine settings file holds both keys', async () => {
    const port = await freePort();
    await connectedWith('c73-ac33', {
      portsAttributes: {[String(port)]: {label: 'Written'}},
      otherPortsAttributes: {label: 'Elsewhere'},
    });
    const [containerId = ''] = await devContainersOf(folderOf('c73-ac33'));
    const {stdout} = await execFileAsync('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      'cat /root/.vscodium-server-insiders/data/Machine/settings.json',
    ]);
    deepStrictEqual(JSON.parse(stdout) as unknown, {
      'remote.portsAttributes': {[String(port)]: {label: 'Written'}},
      'remote.otherPortsAttributes': {label: 'Elsewhere'},
    });
  });

  it('F-1101 AC-34 (against-user): the configuration wins per port over the user’s settings, which keep the ports it does not name', async () => {
    const [named, userOnly, other] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const saved = readUserSettings();
    await userSettings({
      'remote.portsAttributes': {
        [String(named)]: {label: 'FromUser'},
        [String(userOnly)]: {label: 'UserOnly'},
      },
      'remote.otherPortsAttributes': {label: 'UserOther'},
    });
    try {
      const window = await connectedWith('c73-ac34', {
        forwardPorts: [named, userOnly, other],
        portsAttributes: {[String(named)]: {label: 'FromDC'}},
        otherPortsAttributes: {label: 'DCOther'},
      });
      deepStrictEqual(
        await portColumn(window, 3),
        [
          `FromDC (${String(named)})`,
          `UserOnly (${String(userOnly)})`,
          `DCOther (${String(other)})`,
        ].sort(),
      );
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-1101 AC-35 (customizations): the customizations’ settings win per port over the top level, and the last other-ports value wins whole', async () => {
    const [both, custOnly, topOnly, other] = [
      await freePort(),
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const window = await connectedWith('c73-ac35', {
      forwardPorts: [both, custOnly, topOnly, other],
      portsAttributes: {
        [String(both)]: {label: 'FromDC', onAutoForward: 'silent'},
        [String(topOnly)]: {label: 'DCOnly'},
      },
      otherPortsAttributes: {label: 'DCOther'},
      customizations: {
        vscode: {
          settings: {
            'remote.portsAttributes': {
              [String(both)]: {label: 'FromCust'},
              [String(custOnly)]: {label: 'CustOnly'},
            },
            'remote.otherPortsAttributes': {label: 'CustOther'},
          },
        },
      },
    });
    deepStrictEqual(
      await portColumn(window, 4),
      [
        `FromCust (${String(both)})`,
        `CustOnly (${String(custOnly)})`,
        `DCOnly (${String(topOnly)})`,
        `CustOther (${String(other)})`,
      ].sort(),
    );
  });

  it('F-1101 AC-12 (rebuild): a changed attribute is not in effect after a reload, and is after a rebuild', async () => {
    const port = await freePort();
    const window = await connectedWith('c73-ac12', {
      forwardPorts: [port],
      portsAttributes: {[String(port)]: {label: 'Before'}},
    });
    editConfiguration(folderOf('c73-ac12'), {
      forwardPorts: [port],
      portsAttributes: {[String(port)]: {label: 'After'}},
    });
    await reloaded(window);
    const afterReload = await portColumn(window, 1);
    await reopenInContainer(
      window,
      300_000,
      'remote-containers.rebuildContainer',
    );
    const afterRebuild = await portColumn(window, 1);
    deepStrictEqual(
      [afterReload, afterRebuild],
      [[`Before (${String(port)})`], [`After (${String(port)})`]],
    );
  });

  it('F-1101 AC-3 (other-label): a detected port no key matches is labelled from otherPortsAttributes with no notice, for a user process and for one of the server user', async () => {
    const userPort = await freePort();
    const window = await connectedWith('c73b-ac3', {
      otherPortsAttributes: {label: 'Other', onAutoForward: 'silent'},
    });
    const [containerId = ''] = await devContainersOf(folderOf('c73b-ac3'));
    const stop = await ensureListening(containerId, userPort, () =>
      listenInTerminal(window, containerId, userPort),
    );
    try {
      await showPorts(window);
      const rows = await rowsWhen(window, shown =>
        shown.some(each => each.port === `Other (${String(userPort)})`),
      );
      const listening = await listeningPorts(containerId);
      deepStrictEqual(
        {
          rows: rows.map(shown => [shown.port, shown.origin]).sort(),
          listedElsewhere: listening.filter(
            each =>
              each !== String(userPort) &&
              rows.some(shown => shown.port === `Other (${each})`),
          ),
          notice: (await notificationCentre(window)).filter(text =>
            text.includes(String(userPort)),
          ),
          dialog: await dialogOf(window),
        },
        {
          rows: [[`Other (${String(userPort)})`, 'Auto Forwarded']],
          listedElsewhere: [],
          notice: [],
          dialog: undefined,
        },
      );
    } finally {
      await stop();
    }
  });

  it('F-1101 AC-39 (regex-spaces): a regex key with spaces between the arguments does not label the row, and the same key with a dot for each space does', async () => {
    const port = await freePort();
    const window = await connectedWith('c73b-ac39', {
      portsAttributes: {
        [`.*-p ${String(port)} -e cat.*`]: {label: 'Spaced'},
        [`.*-p.${String(port)}.-e.cat.*`]: {label: 'Dotted'},
      },
    });
    const [containerId = ''] = await devContainersOf(folderOf('c73b-ac39'));
    const stop = await ensureListening(containerId, port, () =>
      listenInTerminal(window, containerId, port),
    );
    try {
      const rows = await rowsWhen(window, shown =>
        shown.some(each => each.port.endsWith(`(${String(port)})`)),
      );
      deepStrictEqual(
        [
          portsOf(rows),
          (await notificationCentre(window)).filter(text =>
            text.includes(String(port)),
          ),
        ],
        [[`Dotted (${String(port)})`], []],
      );
    } finally {
      await stop();
    }
  });
});
