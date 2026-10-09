import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {
  createFailurePresenter,
  type FailureEditor,
  type FailureUiOptions,
  type ModalChoice,
} from '../../src/surfaces/failure-ui.ts';

const BASE: Failed = {
  kind: 'unreachable',
  retryable: false,
  silent: false,
  userAlreadyNotified: false,
  hints: [],
  diagnostics: [],
};

const OPTIONS: FailureUiOptions = {
  hostAlias: () => 'box',
  applicationName: 'codium',
  displayName: 'Remote - SSH',
  documentationUrl: 'https://example.invalid/docs',
  openConfigFileCommand: 'ssh.openConfigFile',
  extensionIds: ['one.ssh', 'one.edit', 'one.explorer'],
};

interface ModalSeen {
  message: string;
  labels: string[];
  dismissLabel: string;
}

/** An editor that answers as told and records what it was asked. */
class FakeEditor implements FailureEditor {
  modals: ModalSeen[] = [];
  picks: Array<{placeholder: string; labels: string[]}> = [];
  commands: unknown[][] = [];
  opened: string[] = [];
  chooseLabel = '';
  pickLabel: string | undefined;

  translate = (template: string): string => template;

  showModal<Choice extends string>(request: {
    message: string;
    choices: ReadonlyArray<ModalChoice<Choice>>;
    dismissChoice: Choice;
  }): Promise<Choice> {
    const dismissed = request.choices.find(
      choice => choice.choice === request.dismissChoice,
    );
    this.modals.push({
      message: request.message,
      labels: request.choices.map(choice => choice.label),
      dismissLabel: dismissed?.label ?? '',
    });
    const chosen = request.choices.find(
      choice => choice.label === this.chooseLabel,
    );
    return Promise.resolve(chosen?.choice ?? request.dismissChoice);
  }

  pickAction<Value extends string>(request: {
    placeholder: string;
    items: ReadonlyArray<{label: string; value: Value}>;
  }): Promise<Value | undefined> {
    this.picks.push({
      placeholder: request.placeholder,
      labels: request.items.map(item => item.label),
    });
    return Promise.resolve(
      request.items.find(item => item.label === this.pickLabel)?.value,
    );
  }

  runCommand(command: string, ...parameters: unknown[]): PromiseLike<unknown> {
    this.commands.push([command, ...parameters]);
    return Promise.resolve(undefined);
  }

  openExternal(address: string): PromiseLike<unknown> {
    this.opened.push(address);
    return Promise.resolve(undefined);
  }
}

function presenterWith(
  editor: FakeEditor,
): (failed: Failed) => Promise<string> {
  const presenter = createFailurePresenter(editor, OPTIONS);
  return failed => presenter.present(failed);
}

async function messageOf(failed: Failed): Promise<string | undefined> {
  const editor = new FakeEditor();
  await presenterWith(editor)(failed);
  return editor.modals[0]?.message;
}

describe('the failure dialog: its message (F-2601)', () => {
  it('F-2601: a failure with no reason names the host and ends with a full stop', async () => {
    deepStrictEqual(
      await messageOf(BASE),
      'Could not establish connection to "box".',
    );
  });

  it('F-2601: a text reason follows the host and gets a full stop', async () => {
    deepStrictEqual(
      await messageOf({...BASE, reason: {text: 'Connection refused'}}),
      'Could not establish connection to "box": Connection refused.',
    );
  });

  it('F-2601: a reason that ends with a full stop does not get a second one', async () => {
    deepStrictEqual(
      await messageOf({
        ...BASE,
        reason: {text: 'Permission denied (publickey).'},
      }),
      'Could not establish connection to "box": Permission denied (publickey).',
    );
  });

  it('F-2601: a reason that is a string id is shown as its text', async () => {
    deepStrictEqual(
      await messageOf({...BASE, reason: {id: 'S032'}}),
      'Could not establish connection to "box": Could not resolve hostname.',
    );
  });

  it('F-2601: a reason id the table does not know counts as no reason', async () => {
    deepStrictEqual(
      await messageOf({...BASE, reason: {id: 'S999'}}),
      'Could not establish connection to "box".',
    );
  });

  it('F-2601: an empty text reason counts as no reason', async () => {
    deepStrictEqual(
      await messageOf({...BASE, reason: {text: ''}}),
      'Could not establish connection to "box".',
    );
  });

  it('F-2601: a declined licence is told as a cancelled connect', async () => {
    deepStrictEqual(
      await messageOf({...BASE, kind: 'licenceDeclined'}),
      'Could not establish connection to "box": Connecting was canceled.',
    );
  });
});

describe('the failure dialog: its buttons (F-2601)', () => {
  it('F-2601: the buttons are Retry, More Actions... and Close Remote, in that order', async () => {
    const editor = new FakeEditor();
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.modals[0]?.labels, [
      'Retry',
      'More Actions...',
      'Close Remote',
    ]);
  });

  it('F-2601: Escape and the close button choose More Actions...', async () => {
    const editor = new FakeEditor();
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.modals[0]?.dismissLabel, 'More Actions...');
  });

  it('F-2601: Retry reloads the window', async () => {
    const editor = new FakeEditor();
    editor.chooseLabel = 'Retry';
    deepStrictEqual(await presenterWith(editor)(BASE), 'reload');
  });

  it('F-2601: Close Remote leaves the remote', async () => {
    const editor = new FakeEditor();
    editor.chooseLabel = 'Close Remote';
    deepStrictEqual(await presenterWith(editor)(BASE), 'closeRemote');
  });

  it('F-2601: Retry and Close Remote open no picker', async () => {
    const editor = new FakeEditor();
    editor.chooseLabel = 'Retry';
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.picks, []);
  });
});

describe('the picker behind More Actions... (F-2602)', () => {
  it('F-2602: it has its placeholder and five items in order', async () => {
    const editor = new FakeEditor();
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.picks, [
      {
        placeholder: 'Pick an action to help resolve the problem.',
        labels: [
          'Reload Window',
          'Open Recent...',
          'Open Documentation',
          'Open SSH Configuration File',
          'Open Settings',
        ],
      },
    ]);
  });

  it('F-2602: Escape ends the flow with nothing done', async () => {
    const editor = new FakeEditor();
    deepStrictEqual(
      [await presenterWith(editor)(BASE), editor.commands, editor.opened],
      ['handled', [], []],
    );
  });

  it('F-2602: Reload Window reloads', async () => {
    const editor = new FakeEditor();
    editor.pickLabel = 'Reload Window';
    deepStrictEqual(await presenterWith(editor)(BASE), 'reload');
  });

  it('F-2602: Open Recent runs the editor command for it', async () => {
    const editor = new FakeEditor();
    editor.pickLabel = 'Open Recent...';
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.commands, [['workbench.action.openRecent']]);
  });

  it('F-2602: Open Documentation hands the documentation address to the browser', async () => {
    const editor = new FakeEditor();
    editor.pickLabel = 'Open Documentation';
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.opened, ['https://example.invalid/docs']);
  });

  it('F-2602: Open SSH Configuration File runs the command of the extension', async () => {
    const editor = new FakeEditor();
    editor.pickLabel = 'Open SSH Configuration File';
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.commands, [['ssh.openConfigFile']]);
  });

  it('F-2602: Open Settings searches the extension and its companions', async () => {
    const editor = new FakeEditor();
    editor.pickLabel = 'Open Settings';
    await presenterWith(editor)(BASE);
    deepStrictEqual(editor.commands, [
      ['workbench.action.openSettings', '@ext:one.ssh,one.edit,one.explorer'],
    ]);
  });

  it('F-2602: after an action the flow ends as handled', async () => {
    const editor = new FakeEditor();
    editor.pickLabel = 'Open Settings';
    deepStrictEqual(await presenterWith(editor)(BASE), 'handled');
  });
});

describe('the dialog for a download place that is missing (F-3902 rule 8)', () => {
  const NO_SOURCE: Failed = {...BASE, kind: 'noServerSource'};

  it('F-3902: it names the editor, the setting and the extension', async () => {
    deepStrictEqual(
      await messageOf(NO_SOURCE),
      "Remote - SSH has no built-in VS Code Server download location for codium. Set remote.SSH.serverDownloadUrlTemplate to a URL template for this editor's own server builds.",
    );
  });

  it('F-3902: an unusable template names the problem', async () => {
    deepStrictEqual(
      await messageOf({
        ...BASE,
        kind: 'invalidServerTemplate',
        reason: {text: 'unknown placeholder ${platform}'},
      }),
      'The value of remote.SSH.serverDownloadUrlTemplate is not a usable VS Code Server download URL template: unknown placeholder ${platform}.',
    );
  });

  it('F-3902: the buttons are Open Setting and Cancel, and Escape is Cancel', async () => {
    const editor = new FakeEditor();
    await presenterWith(editor)(NO_SOURCE);
    deepStrictEqual(
      [editor.modals[0]?.labels, editor.modals[0]?.dismissLabel],
      [['Open Setting', 'Cancel'], 'Cancel'],
    );
  });

  it('F-3902: Open Setting searches the setting in the settings editor', async () => {
    const editor = new FakeEditor();
    editor.chooseLabel = 'Open Setting';
    await presenterWith(editor)(NO_SOURCE);
    deepStrictEqual(editor.commands, [
      ['workbench.action.openSettings', 'remote.SSH.serverDownloadUrlTemplate'],
    ]);
  });

  it('F-3902: Cancel only closes the dialog', async () => {
    const editor = new FakeEditor();
    deepStrictEqual(
      [await presenterWith(editor)(NO_SOURCE), editor.commands],
      ['handled', []],
    );
  });

  it('F-3902: the picker of F-2602 is not offered', async () => {
    const editor = new FakeEditor();
    await presenterWith(editor)(NO_SOURCE);
    deepStrictEqual(editor.picks, []);
  });
});

describe('the failure dialog: the display language', () => {
  it('F-2601: every text goes through the translation of the editor', async () => {
    const editor = new FakeEditor();
    editor.translate = template => `[${template}]`;
    await presenterWith(editor)(BASE);
    deepStrictEqual(
      [editor.modals[0]?.message, editor.modals[0]?.labels[0]],
      ['[Could not establish connection to "box"].', '[Retry]'],
    );
  });
});
