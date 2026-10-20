import {deepStrictEqual} from 'node:assert';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  commandsOf,
  devContainerFolder,
  devContainersOf,
  inWindow,
  listenIn,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {
  answerInputBox,
  portRowActions,
  portsRows,
  type PortsRow,
  statusItem,
} from '../windows/renderer.ts';

/** The command that focuses core's Ports view. */
const FOCUS_PORTS = '~remote.forwardedPorts.focus';

describe('the Ports view readout (card tooling-56)', function () {
  this.timeout(600_000);

  it('#1228: the Ports view readout reads a hand-forwarded port', async () => {
    const folder = devContainerFolder('t56-ports', {name: 'Ports'});
    const name = await openFolderWindow(folder);
    let stopListening: (() => Promise<void>) | undefined = undefined;
    try {
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      stopListening = await listenIn(containerId, 41999);
      const forwarding = inWindow(name, 'remote.tunnel.forwardCommandPalette');
      await answerInputBox(name, '41999');
      await forwarding;
      await waitFor(
        'core to register the Ports view',
        async () => (await commandsOf(name, FOCUS_PORTS)).includes(FOCUS_PORTS),
        20_000,
      );
      await inWindow(name, FOCUS_PORTS);
      let rows: PortsRow[] = [];
      await waitFor(
        'the Ports view to show port 41999 with its process',
        async () => {
          rows = await portsRows(name);
          return rows.length === 1 && rows[0]?.runningProcess !== '';
        },
        10_000,
      );
      const actions = await portRowActions(name, '41999');
      deepStrictEqual(
        {
          rows: rows.map(shown => [shown.port, shown.origin]),
          stopOffered: [
            actions.inline.includes('Stop Forwarding Port'),
            actions.menu.includes('Stop Forwarding Port'),
          ],
          status: (await statusItem(name, 'status.forwardedPorts')).ariaLabel,
        },
        {
          rows: [['41999', 'User Forwarded']],
          stopOffered: [true, true],
          status: 'Forwarded Ports: 41999',
        },
      );
    } finally {
      await stopListening?.();
      await closeWindow(name);
      await removeContainers(folder);
    }
  });
});
