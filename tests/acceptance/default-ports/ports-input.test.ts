import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  nextEmptyWindow,
  openWindow,
  terminalBuffer,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerInputBox,
  inputBoxOf,
  portProtocolChoices,
  portRowActions,
  portsRows,
  rememberPage,
  typeInFocus,
  typeInTerminal,
} from '../windows/renderer.ts';
import {showPorts} from './forward-support.ts';

/** The variable of the client's environment the rows look for: the launch gives it to the editor, and its value is not a word of the rows. */
const CLIENT_VARIABLE = 'HARNESS_RUN_FOLDER';

/** The privileged port the row forwards by hand. */
const PRIVILEGED_PORT = 81;

/** What a terminal printed for `printenv` of the variable: the line it ends with, `none` for a terminal that printed nothing of it. */
async function valueIn(window: string): Promise<string> {
  await inWindow(window, 'workbench.action.terminal.new');
  const marker = `c100-${String(Date.now())}`;
  await typeInTerminal(
    window,
    `echo ${marker}:$(printenv ${CLIENT_VARIABLE} || echo none)\n`,
  );
  let found = '';
  await waitFor(
    `the terminal of window ${window} to print ${marker}`,
    async () => {
      const lines = (await terminalBuffer(window)).split('\n');
      found =
        lines
          .filter(line => line.startsWith(`${marker}:`))
          .at(-1)
          ?.slice(marker.length + 1)
          .trim() ?? '';
      return found !== '';
    },
    30_000,
  );
  return found;
}

describe('the Ports view of an SSH window (card coverage-100)', function () {
  this.timeout(300_000);

  it('F-2501 AC-35 (c100-ports-input): the Forward a Port input shows no hint about sudo for a port below 1024, the forwarded row has Change Port Protocol and no Port Visibility, and the client’s environment is not in a remote terminal', async () => {
    const window = 'c100-a35';
    await openWindow('harness', window);
    try {
      const forwarding = inWindow(
        window,
        'remote.tunnel.forwardCommandPalette',
      );
      await waitFor(
        'the Forward a Port input',
        async () => (await inputBoxOf(window)) !== undefined,
        30_000,
      );
      await typeInFocus(window, String(PRIVILEGED_PORT));
      await new Promise(resolve => setTimeout(resolve, 1500));
      const shown = await inputBoxOf(window);
      await answerInputBox(window, String(PRIVILEGED_PORT));
      await forwarding;
      await showPorts(window);
      await waitFor(
        `the Ports view to show port ${String(PRIVILEGED_PORT)}`,
        async () =>
          (await portsRows(window).catch(() => [])).some(
            row => row.port === String(PRIVILEGED_PORT),
          ),
        30_000,
      );
      const actions = await portRowActions(window, String(PRIVILEGED_PORT));
      const protocol = await portProtocolChoices(
        window,
        String(PRIVILEGED_PORT),
      );
      const remote = await valueIn(window);
      await closeWindow(window);
      await rememberPage('local');
      const local = await nextEmptyWindow(() =>
        inWindow('local', 'workbench.action.newWindow'),
      );
      await rememberPage(local);
      try {
        deepStrictEqual(
          {
            sudoHint: /sudo/i.test(
              `${shown?.message ?? ''} ${shown?.title ?? ''}`,
            ),
            changeProtocol: actions.menu.includes('Change Port Protocol'),
            portVisibility: actions.menu.some(item => /visibility/i.test(item)),
            protocolChoices: protocol.choices.map(([label]) => label),
            remote,
            localControl: await valueIn(local),
          },
          {
            sudoHint: false,
            changeProtocol: true,
            portVisibility: false,
            protocolChoices: ['HTTP', 'HTTPS'],
            remote: 'none',
            localControl: variable(CLIENT_VARIABLE),
          },
        );
      } finally {
        await closeWindow(local);
      }
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
