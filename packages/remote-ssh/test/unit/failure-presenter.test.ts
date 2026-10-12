import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {
  type FailureActions,
  type FailureDialogPort,
  failurePresenterOf,
} from '../../src/surfaces/failure-presenter.ts';

function failedWith(parts: Partial<Failed> = {}): Failed {
  return {
    kind: 'channelClosed',
    retryable: false,
    silent: false,
    userAlreadyNotified: false,
    hints: [],
    diagnostics: [],
    ...parts,
  };
}

/** What the fakes saw. */
interface Seen {
  dialogs: Array<{text: string; buttons: readonly string[]}>;
  calls: string[];
}

function surroundings(
  choose: (buttons: readonly string[]) => PromiseLike<string | undefined>,
) {
  const seen: Seen = {dialogs: [], calls: []};
  const dialog: FailureDialogPort = {
    showError: (text, buttons) => {
      seen.dialogs.push({text, buttons});
      return choose(buttons);
    },
  };
  const actions: FailureActions = {
    reload: () => {
      seen.calls.push('reload');
      return Promise.resolve();
    },
    closeRemote: () => {
      seen.calls.push('closeRemote');
      return Promise.resolve();
    },
    moreActions: failed => {
      seen.calls.push(`moreActions ${failed.kind}`);
      return Promise.resolve();
    },
    openSetting: settingId => {
      seen.calls.push(`openSetting ${settingId}`);
      return Promise.resolve();
    },
  };
  const presenter = failurePresenterOf(dialog, actions, template => template, {
    alias: () => 'box',
    applicationName: 'VSCodium',
    displayName: 'Remote - SSH',
  });
  return {presenter, seen};
}

/** Lets the chain behind a started dialog run. */
async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

async function textFor(parts: Partial<Failed>): Promise<string | undefined> {
  const {presenter, seen} = surroundings(() => Promise.resolve(undefined));
  await presenter.present(failedWith(parts));
  return seen.dialogs[0]?.text;
}

describe('the failure presenter', () => {
  it('F-2601 S030: a failure without a reason names the host, with a full stop', async () => {
    deepStrictEqual(
      await textFor({}),
      'Could not establish connection to "box".',
    );
  });

  it('F-2601 S031: a reason that is text follows the host', async () => {
    deepStrictEqual(
      await textFor({reason: {text: 'Connection refused'}}),
      'Could not establish connection to "box": Connection refused.',
    );
  });

  it('F-2601 S031: a reason that ends with a full stop gets no second one', async () => {
    deepStrictEqual(
      await textFor({reason: {text: 'Host key changed.'}}),
      'Could not establish connection to "box": Host key changed.',
    );
  });

  it('F-2601 S031: a reason that is an id is translated through the table', async () => {
    deepStrictEqual(
      await textFor({reason: {id: 'S027'}}),
      'Could not establish connection to "box": Connecting was canceled.',
    );
  });

  it('F-2601: a reason that is a classifier id shows its text', async () => {
    deepStrictEqual(
      await textFor({reason: {id: 'S094'}}),
      'Could not establish connection to "box": Network is unreachable.',
    );
  });

  it('F-2601: a reason that is an id without a template shows the text of a failure without reason, never the id', async () => {
    deepStrictEqual(
      await textFor({reason: {id: 'S999'}}),
      'Could not establish connection to "box".',
    );
  });

  it('F-2601: the buttons are Close Remote, Retry and More Actions', async () => {
    const {presenter, seen} = surroundings(() => Promise.resolve(undefined));
    await presenter.present(failedWith());
    deepStrictEqual(seen.dialogs[0]?.buttons, [
      'Close Remote',
      'Retry',
      'More Actions...',
    ]);
  });

  it('contracts 3.2: the window is told "handled" while the dialog is still open', async () => {
    const {presenter} = surroundings(
      () => new Promise<string | undefined>(() => undefined),
    );
    deepStrictEqual(await presenter.present(failedWith()), 'handled');
  });

  for (const [button, called] of [
    ['Retry', 'reload'],
    ['Close Remote', 'closeRemote'],
    ['More Actions...', 'moreActions channelClosed'],
    [undefined, 'moreActions channelClosed'],
  ] as const) {
    it(`F-2601: ${String(button)} calls ${called} once`, async () => {
      const {presenter, seen} = surroundings(() => Promise.resolve(button));
      await presenter.present(failedWith());
      await settle();
      deepStrictEqual(seen.calls, [called]);
    });
  }

  it('contracts 3.2: a dialog that rejects leaves "handled" and no unhandled rejection', async () => {
    const {presenter, seen} = surroundings(() =>
      Promise.reject(new Error('the editor failed')),
    );
    const outcome = await presenter.present(failedWith());
    await settle();
    deepStrictEqual([outcome, seen.calls], ['handled', []]);
  });

  it('contracts 3.2: an action that rejects is swallowed', async () => {
    const seen: string[] = [];
    const presenter = failurePresenterOf(
      {showError: () => Promise.resolve('Retry')},
      {
        reload: () => Promise.reject(new Error('reload failed')),
        closeRemote: () => Promise.resolve(),
        moreActions: () => Promise.resolve(),
        openSetting: () => Promise.resolve(),
      },
      template => template,
      {alias: () => 'box', applicationName: 'A', displayName: 'B'},
    );
    const outcome = await presenter.present(failedWith());
    await settle();
    seen.push(outcome);
    deepStrictEqual(seen, ['handled']);
  });

  it('F-3902 rule 8: no server source shows its text with the four values and Open Setting and Cancel', async () => {
    const {presenter, seen} = surroundings(() => Promise.resolve(undefined));
    await presenter.present(failedWith({kind: 'noServerSource'}));
    deepStrictEqual(seen.dialogs[0], {
      text: "Remote - SSH knows no download location for the server of VSCodium. Set remote.SSH.serverDownloadUrlTemplate to a URL template for this editor's server builds.",
      buttons: ['Open Setting', 'Cancel'],
    });
  });

  it('F-3902 rule 8: an invalid template shows the reason in its text', async () => {
    const {presenter, seen} = surroundings(() => Promise.resolve(undefined));
    await presenter.present(
      failedWith({
        kind: 'invalidServerTemplate',
        reason: {text: 'no {version}'},
      }),
    );
    deepStrictEqual(
      seen.dialogs[0]?.text,
      'The value of remote.SSH.serverDownloadUrlTemplate is not a usable server download URL template: no {version}.',
    );
  });

  it('F-3902 rule 8: an invalid template without a reason leaves its place empty', async () => {
    const {presenter, seen} = surroundings(() => Promise.resolve(undefined));
    await presenter.present(failedWith({kind: 'invalidServerTemplate'}));
    deepStrictEqual(
      seen.dialogs[0]?.text,
      'The value of remote.SSH.serverDownloadUrlTemplate is not a usable server download URL template: .',
    );
  });

  it('F-3902 rule 8: Open Setting opens the setting of the template', async () => {
    const {presenter, seen} = surroundings(() =>
      Promise.resolve('Open Setting'),
    );
    await presenter.present(failedWith({kind: 'invalidServerTemplate'}));
    await settle();
    deepStrictEqual(seen.calls, [
      'openSetting remote.SSH.serverDownloadUrlTemplate',
    ]);
  });

  it('F-3902 rule 8: Cancel and closing do nothing', async () => {
    const cancel = surroundings(() => Promise.resolve('Cancel'));
    const closed = surroundings(() => Promise.resolve(undefined));
    await cancel.presenter.present(failedWith({kind: 'noServerSource'}));
    await closed.presenter.present(failedWith({kind: 'noServerSource'}));
    await settle();
    deepStrictEqual([cancel.seen.calls, closed.seen.calls], [[], []]);
  });
});
