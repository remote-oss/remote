import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type RecoveryEditor,
  recoveryPortsOf,
} from '../../src/surfaces/recovery-editor.ts';

/** An editor that records what it is asked and answers `answer`. */
function editor(answer?: string) {
  const answered = answer === undefined ? undefined : {title: answer};
  const calls: unknown[][] = [];
  const fake: RecoveryEditor<object> = {
    window: {
      showErrorMessage: (message, options, ...items) => {
        calls.push(['showErrorMessage', message, options, ...items]);
        return Promise.resolve(answered);
      },
      showQuickPick: (items, options) => {
        calls.push(['showQuickPick', items, options]);
        return Promise.resolve(answer);
      },
    },
    commands: {
      executeCommand: (command, ...parameters) => {
        calls.push(['executeCommand', command, ...parameters]);
        return Promise.resolve(undefined);
      },
    },
    env: {
      openExternal: address => {
        calls.push(['openExternal', address]);
        return Promise.resolve(true);
      },
    },
    // eslint-disable-next-line id-length -- the editor's API names its URI helper Uri
    Uri: {
      file: path => ({file: path}),
      parse: address => ({parsed: address}),
    },
  };
  const ports = recoveryPortsOf(fake, {
    keepEdit: () => Promise.resolve(),
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
  });
  return {ports, calls};
}

describe('the editor adapters of the failure presenter (card containers-11)', () => {
  it('F-0410 AC-1: the error is modal, with the detail and the buttons with their close affordance, and answers the chosen label', async () => {
    const {ports, calls} = editor('Retry');
    const chosen = await ports.showError('', 'detail', [
      {title: 'Retry'},
      {title: 'More', isCloseAffordance: true},
    ]);
    deepStrictEqual(
      [chosen, calls],
      [
        'Retry',
        [
          [
            'showErrorMessage',
            '',
            {modal: true, detail: 'detail'},
            {title: 'Retry'},
            {title: 'More', isCloseAffordance: true},
          ],
        ],
      ],
    );
  });

  it('F-0202 AC-9: the quick pick has a placeholder, no title and the labels, and answers the chosen one', async () => {
    const {ports, calls} = editor('Open Recent...');
    const chosen = await ports.pick('Pick one', [
      'Reload Window',
      'Open Recent...',
    ]);
    deepStrictEqual(
      [chosen, calls],
      [
        'Open Recent...',
        [
          [
            'showQuickPick',
            ['Reload Window', 'Open Recent...'],
            {placeHolder: 'Pick one'},
          ],
        ],
      ],
    );
  });

  it('F-0410 AC-4: opening locally reopens the folder in this window', async () => {
    const {ports, calls} = editor();
    await ports.openLocally('/w/proj');
    deepStrictEqual(calls, [
      [
        'executeCommand',
        'vscode.openFolder',
        {file: '/w/proj'},
        {forceReuseWindow: true},
      ],
    ]);
  });

  it('F-0202 AC-18, AC-9, F-0503 7.E1: reload, recent, an address and a setting run the editor’s own commands', async () => {
    const {ports, calls} = editor();
    await ports.reloadWindow();
    await ports.openRecent();
    await ports.openExternal('https://example.org/x');
    await ports.openSetting('remote.serverDownloadBaseUrl');
    deepStrictEqual(calls, [
      ['executeCommand', 'workbench.action.reloadWindow'],
      ['executeCommand', 'workbench.action.openRecent'],
      ['openExternal', {parsed: 'https://example.org/x'}],
      [
        'executeCommand',
        'workbench.action.openSettings',
        'remote.serverDownloadBaseUrl',
      ],
    ]);
  });

  it('F-0410 AC-5: later runs the task after the call stack has unwound', async () => {
    const {ports} = editor();
    const order: string[] = [];
    await new Promise<void>(resolve => {
      ports.later(() => {
        order.push('task');
        resolve();
      });
      order.push('after the call');
    });
    deepStrictEqual(order, ['after the call', 'task']);
  });
});
