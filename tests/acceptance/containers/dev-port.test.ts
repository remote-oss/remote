import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {connect, createServer, type AddressInfo, type Server} from 'node:net';
import {promisify} from 'node:util';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  containersLog,
  devContainerFolder,
  inWindow,
  reopenStarted,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  notificationCentre,
  problemsOf,
  statusItem,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  connectedWindow,
  docker,
  logSince,
  serverPortsOf,
} from './resolve-support.ts';

const execFileAsync = promisify(execFile);

/** The log line of the host relay: the host port it listens on and the container port it forwards to. */
const FORWARDING = /^forwarding local port (\d+) to container port (\d+)$/;

/** The detail of F-0410's dialog for a setup that failed. */
const S034 = 'An error occurred setting up the container.';

/** A free loopback port of the host: bound and released at once. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => {
    probe.listen(0, '127.0.0.1', resolve);
  });
  const {port} = probe.address() as AddressInfo;
  await new Promise(resolve => {
    probe.close(resolve);
  });
  return port;
}

/** The host and container ports of the relay lines of `lines`. */
function forwardsOf(lines: readonly string[]): number[][] {
  return lines.flatMap(line => {
    const match = FORWARDING.exec(line);
    return match === null ? [] : [[Number(match[1]), Number(match[2])]];
  });
}

/** What a connect to a configuration with a `devPort` shows, from the lines the Dev Containers log gave. */
async function connectedWith(
  label: string,
  configuration: Readonly<Record<string, unknown>>,
): Promise<{
  name: string;
  folder: string;
  containerId: string;
  lines: string[];
}> {
  const mark = containersLog().length;
  const connected = await connectedWindow(label, configuration);
  return {...connected, lines: logSince(mark)};
}

/** Whether the host listens on 127.0.0.1:`port`, by `ss -ltn`. */
async function hostListens(port: number): Promise<boolean> {
  const {stdout} = await execFileAsync('ss', ['-ltn']);
  return stdout.includes(`127.0.0.1:${String(port)} `);
}

/** The ports the container publishes on the host, as Docker holds them. */
async function publishedPorts(containerId: string): Promise<string> {
  return docker(
    'inspect',
    '--format',
    '{{json .NetworkSettings.Ports}}',
    containerId,
  );
}

describe('the server listens on the configuration’s devPort (card containers-107)', function () {
  this.timeout(900_000);

  it('F-0502 AC-9 (dev-port-vscode): customizations.vscode.devPort fixes the server’s port: the log reports it and the forward, the host listens on it, and the container publishes no port', async () => {
    const port = await freePort();
    const {name, folder, containerId, lines} = await connectedWith(
      'c107-vscode',
      {customizations: {vscode: {devPort: port}}},
    );
    try {
      deepStrictEqual(
        {
          listening: serverPortsOf(lines),
          forwards: forwardsOf(lines),
          hostListens: await hostListens(port),
          published: await publishedPorts(containerId),
        },
        {
          listening: [port],
          forwards: [[port, port]],
          hostListens: true,
          published: '{}',
        },
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-10 (dev-port-top-level): the top-level devPort acts the same, with no dialog or notification, and the file shows the two Problems-panel warnings', async () => {
    const port = await freePort();
    const {name, folder, containerId, lines} = await connectedWith(
      'c107-top-level',
      {devPort: port},
    );
    try {
      await inWindow(
        name,
        'acceptance.agent.openFile',
        '.devcontainer/devcontainer.json',
      );
      let messages: string[] = [];
      await waitFor(
        'the two warnings of the top-level devPort',
        async () => {
          messages = (await problemsOf(name)).map(problem => problem.message);
          return messages.length >= 2;
        },
        60_000,
      );
      deepStrictEqual(
        {
          listening: serverPortsOf(lines),
          forwards: forwardsOf(lines),
          hostListens: await hostListens(port),
          published: await publishedPorts(containerId),
          dialog: await dialogOf(name),
          notices: await notificationCentre(name),
          problems: messages.sort(),
        },
        {
          listening: [port],
          forwards: [[port, port]],
          hostListens: true,
          published: '{}',
          dialog: undefined,
          notices: [],
          problems: [
            'Property devPort is not allowed.',
            "Use 'customizations/vscode/devPort' instead",
          ].sort(),
        },
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-24 (dev-port-two): two folders with the same devPort both connect with no dialog or notification, each server listens on it in its own container, and the second host forward uses another port', async () => {
    const port = await freePort();
    const configuration = {customizations: {vscode: {devPort: port}}};
    const first = await connectedWith('c107-two-a', configuration);
    let second: Awaited<ReturnType<typeof connectedWith>> | undefined;
    try {
      second = await connectedWith('c107-two-b', configuration);
      async function inside(containerId: string): Promise<boolean> {
        return (
          await docker('exec', containerId, 'sh', '-c', 'netstat -ltn')
        ).includes(`127.0.0.1:${String(port)} `);
      }
      deepStrictEqual(
        {
          listening: [serverPortsOf(first.lines), serverPortsOf(second.lines)],
          different: first.containerId !== second.containerId,
          inside: [
            await inside(first.containerId),
            await inside(second.containerId),
          ],
          firstForward: forwardsOf(first.lines),
          secondForwardsOther: forwardsOf(second.lines).every(
            ([host]) => host !== port,
          ),
          dialogs: [await dialogOf(first.name), await dialogOf(second.name)],
          notices: [
            await notificationCentre(first.name),
            await notificationCentre(second.name),
          ],
        },
        {
          listening: [[port], [port]],
          different: true,
          inside: [true, true],
          firstForward: [[port, port]],
          secondForwardsOther: true,
          dialogs: [undefined, undefined],
          notices: [[], []],
        },
      );
    } finally {
      await closeWindow(first.name);
      if (second !== undefined) {
        await closeWindow(second.name);
        await removeContainers(second.folder);
      }
      await removeContainers(first.folder);
    }
  });

  it('F-0502 AC-25 (dev-port-held): a program that holds the port on the host is ignored: the window connects with the forward on another port, and the program keeps listening', async () => {
    const port = await freePort();
    const holder: Server = createServer();
    await new Promise<void>(resolve => {
      holder.listen(port, '127.0.0.1', resolve);
    });
    let outcome: Awaited<ReturnType<typeof connectedWith>> | undefined;
    try {
      outcome = await connectedWith('c107-held', {
        customizations: {vscode: {devPort: port}},
      });
      const accepts = await new Promise<boolean>(resolve => {
        const probe = connect(port, '127.0.0.1');
        probe.once('connect', () => {
          probe.destroy();
          resolve(true);
        });
        probe.once('error', () => {
          resolve(false);
        });
      });
      deepStrictEqual(
        {
          listening: serverPortsOf(outcome.lines),
          forwardsOther: forwardsOf(outcome.lines).every(
            ([host, container]) => host !== port && container === port,
          ),
          forwards: forwardsOf(outcome.lines).length,
          holderAccepts: accepts,
        },
        {
          listening: [port],
          forwardsOther: true,
          forwards: 1,
          holderAccepts: true,
        },
      );
    } finally {
      holder.close();
      if (outcome !== undefined) {
        await closeWindow(outcome.name);
        await removeContainers(outcome.folder);
      }
    }
  });

  /** Connects with a `devPort` the start ignores, and gives what the connect showed. */
  async function dynamicPort(
    label: string,
    value: unknown,
  ): Promise<{dynamic: boolean; forwards: number; dialog: unknown}> {
    const outcome = await connectedWith(`c107-${label}`, {
      customizations: {vscode: {devPort: value}},
    });
    try {
      const [listening = 0] = serverPortsOf(outcome.lines);
      return {
        dynamic: listening > 0,
        forwards: forwardsOf(outcome.lines).length,
        dialog: await dialogOf(outcome.name),
      };
    } finally {
      await closeWindow(outcome.name);
      await removeContainers(outcome.folder);
    }
  }

  it('F-0502 AC-26 (dev-port-zero): a devPort of 0 gives a dynamic port and the window connects normally', async () => {
    deepStrictEqual(await dynamicPort('zero', 0), {
      dynamic: true,
      forwards: 1,
      dialog: undefined,
    });
  });

  it('F-0502 AC-26 (dev-port-text): a devPort of "abc" gives a dynamic port and the window connects normally', async () => {
    deepStrictEqual(await dynamicPort('text', 'abc'), {
      dynamic: true,
      forwards: 1,
      dialog: undefined,
    });
  });

  it('F-0502 AC-26 (dev-port-range): a devPort of 70000 ends the start with the setup failure dialog, and the window does not connect', async () => {
    const folder = devContainerFolder('c107-range', {
      name: 'c107-range',
      customizations: {vscode: {devPort: 70000}},
    });
    const name = await openFolderWindow(folder);
    const mark = containersLog().length;
    try {
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 180_000);
      deepStrictEqual(
        {
          details: dialog.details,
          indicator: (await statusItem(name, 'status.host')).text,
          listening: serverPortsOf(logSince(mark)),
        },
        {details: S034, indicator: 'Opening Remote...', listening: []},
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });
});
