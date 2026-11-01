import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  editorProduct,
  inWindow,
  isOpen,
  onHost,
  openWindow,
  reloadWindow,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogDetailLines,
  dialogKindOf,
  dialogOf,
  statusItemText,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  drawn,
  LICENCE_MESSAGE,
  licenceDetail,
} from '../windows/licence-texts.ts';

/** How long the connect takes to reach the licence question, and to finish with a download from the publisher, in milliseconds. */
const QUESTION_MILLISECONDS = 120_000;
const CONNECT_MILLISECONDS = 600_000;

/** The folder of the harness user's home where the VS Code server of the client's commit is installed. */
function serverFolder(): string {
  const product = editorProduct();
  return `/home/harness/${product.serverDataFolderName}/bin/${product.commit}`;
}

describe('a connect past the licence the user accepted, on genuine VS Code (card tooling-97, D-104)', function () {
  this.timeout(1_800_000);

  before(async () => {
    for (const name of windowNames()) {
      if (name !== 'local' && isOpen(name)) {
        await closeWindow(name);
      }
    }
    // The profile is this launch's own, so the licence is asked for; the host's home starts without a server.
    await onHost(
      'sh',
      '-c',
      `rm -rf /home/harness/${editorProduct().serverDataFolderName}`,
    );
  });

  after(async () => {
    await closeWindow('licensed-1').catch(() => undefined);
  });

  it('tooling-97 (accept): rule 11 of the server source: the licence is asked before the download, Accept and Continue takes the server of the client’s commit from the publisher and the window connects as SSH: harness, with a terminal that runs on the host', async () => {
    await openWindow('harness', 'licensed-1');
    const modal = await waitForDialog('licensed-1', QUESTION_MILLISECONDS);
    const asked = {
      modal: {
        message: modal.message,
        buttons: modal.buttons,
        kind: await dialogKindOf('licensed-1'),
      },
      detail: (await dialogDetailLines('licensed-1')).join(' '),
      serverBefore: await onHost('sh', '-c', `ls ${serverFolder()} 2>&1; true`),
    };
    await answerDialog('licensed-1', 'Accept and Continue');
    const indicator = await statusItemText(
      'licensed-1',
      'status.host',
      'SSH: harness',
      CONNECT_MILLISECONDS,
    );
    const hostName = (await onHost('uname', '-n')).trim();
    await inWindow('licensed-1', 'workbench.action.terminal.new');
    await inWindow('licensed-1', 'workbench.action.terminal.sendSequence', {
      text: 'uname -n > /home/harness/licensed-1/terminal-host.txt\n',
    });
    await waitFor(
      'the terminal to write its answer on the host',
      async () =>
        (
          await onHost(
            'sh',
            '-c',
            'cat /home/harness/licensed-1/terminal-host.txt 2>/dev/null; true',
          )
        ).trim() !== '',
      60_000,
    );
    const product = JSON.parse(
      await onHost('cat', `${serverFolder()}/product.json`),
    ) as {commit: string};
    deepStrictEqual(
      {
        asked: {
          ...asked,
          serverBefore: asked.serverBefore.includes('No such file'),
        },
        indicator,
        terminal: (
          await onHost('cat', '/home/harness/licensed-1/terminal-host.txt')
        ).trim(),
        serverCommit: product.commit,
      },
      {
        asked: {
          modal: {
            message: LICENCE_MESSAGE,
            buttons: drawn(['Accept and Continue', 'Cancel']),
            kind: 'info',
          },
          detail: licenceDetail(editorProduct().serverLicenseUrl),
          serverBefore: true,
        },
        indicator: 'SSH: harness',
        terminal: hostName,
        serverCommit: editorProduct().commit,
      },
    );
  });

  it('tooling-97 (remembered): rule 11 of the server source: after a reload the profile is asked nothing, and the window connects again', async () => {
    await reloadWindow('licensed-1');
    const indicator = await statusItemText(
      'licensed-1',
      'status.host',
      'SSH: harness',
      CONNECT_MILLISECONDS,
    );
    deepStrictEqual(
      [indicator, await dialogOf('licensed-1')],
      ['SSH: harness', undefined],
    );
  });
});
