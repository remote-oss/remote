import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import type {HostListResult} from 'lib-ssh';
import {
  connectCommandEditorOf,
  hostPickPortOf,
  openerHostOf,
} from '../../src/connect/connect-editor.ts';
import {pickerModel} from '../../src/connect/picker-model.ts';
import {FakeQuickPick} from './editor-fakes.fixture.ts';

type Editor = Parameters<typeof connectCommandEditorOf>[0];

const HOSTS: HostListResult = {
  hosts: [
    {name: 'dev', file: '/f'},
    {name: 'prod', file: '/f'},
  ],
};

/** A quick pick that also reports the text the user types. */
class TypingQuickPick extends FakeQuickPick {
  private readonly typings: Array<(typedText: string) => void> = [];

  onDidChangeValue(listener: (typedText: string) => void): {dispose(): void} {
    this.typings.push(listener);
    return {dispose: () => undefined};
  }

  type(typedText: string): void {
    for (const listener of this.typings) {
      listener(typedText);
    }
  }
}

/** The editor the adapter drives: the quick picks it created, the commands it ran, what its opener built. */
function fakeEditor(remoteName?: string, refuse?: Error) {
  const picks: TypingQuickPick[] = [];
  const commandsRun: unknown[][] = [];
  const addresses: Array<{scheme: string; authority?: string; path: string}> =
    [];
  const editor = {
    window: {
      createQuickPick: () => {
        const pick = new TypingQuickPick();
        picks.push(pick);
        return pick;
      },
    },
    commands: {
      executeCommand: (command: string, ...parameters: unknown[]) => {
        commandsRun.push([command, ...parameters]);
        return refuse === undefined
          ? Promise.resolve()
          : Promise.reject(refuse);
      },
    },
    env: {remoteName},
    ['Uri']: {
      from: (parts: {scheme: string; authority?: string; path: string}) => {
        addresses.push(parts);
        return parts;
      },
    },
  } as unknown as Editor;
  return {editor, picks, commandsRun, addresses};
}

/** The adapter over a fake editor with the strings left as their templates. */
function adapterOf(fake: ReturnType<typeof fakeEditor>) {
  return connectCommandEditorOf(
    fake.editor,
    () => HOSTS,
    hostPickPortOf(fake.editor, template => template),
  );
}

/** Starts a pick over `HOSTS` through the editor's host pick and gives it with the promise of its answer. */
function started(fake: ReturnType<typeof fakeEditor>) {
  const answer = hostPickPortOf(fake.editor, template => template).pick(
    pickerModel(HOSTS, '') as never,
    typedText => pickerModel(HOSTS, typedText) as never,
  );
  const pick = fake.picks[0];
  if (pick === undefined) {
    throw new Error('no pick');
  }
  return {answer, pick};
}

describe('the host pick of the connect commands (card connect-21)', () => {
  it('F-2411 5.0, F-2301 AC-4: the pick has no title, one choice and the placeholder of the spec, and stays open when the focus moves', () => {
    const {pick} = started(fakeEditor());
    deepStrictEqual(
      [pick.title, pick.canSelectMany, pick.ignoreFocusOut, pick.placeholder],
      [undefined, false, true, 'Select configured SSH host or enter user@host'],
    );
    pick.hide();
  });

  it('F-2301 AC-4: the rows are the hosts in order, then the two fixed rows', () => {
    const {pick} = started(fakeEditor());
    deepStrictEqual(
      pick.items.map(item => item.label),
      ['dev', 'prod', '$(plus) Add New SSH Host...', 'Configure SSH Hosts...'],
    );
    pick.hide();
  });

  it('F-2411 5.0, F-2301 AC-4: the first row is focused', () => {
    const {pick} = started(fakeEditor());
    deepStrictEqual(pick.activeItems, pick.items.slice(0, 1));
    pick.hide();
  });

  it('F-2301 AC-8: the typed text adds its row and keeps the fixed rows listed', () => {
    const {pick} = started(fakeEditor());
    pick.type('lab@h');
    deepStrictEqual(
      pick.items.map(item => [item.label, item.alwaysShow]),
      [
        ['dev', false],
        ['prod', false],
        ['➤ lab@h', true],
        ['$(plus) Add New SSH Host...', true],
        ['Configure SSH Hosts...', true],
      ],
    );
    pick.hide();
  });

  it('connect-29: the focus is set once, before the pick is shown', () => {
    const {pick} = started(fakeEditor());
    deepStrictEqual(pick.focusSets, [false]);
    pick.hide();
  });

  it('connect-29: a change of the text sets the rows and not the focus again', () => {
    const {pick} = started(fakeEditor());
    pick.type('d');
    pick.type('de');
    deepStrictEqual(pick.focusSets, [false]);
    pick.hide();
  });

  it('F-2301 AC-29: a text of only spaces keeps every host listed', () => {
    const {pick} = started(fakeEditor());
    pick.type('   ');
    deepStrictEqual(
      pick.items.slice(0, 2).map(item => item.alwaysShow),
      [true, true],
    );
    pick.hide();
  });

  it('connect-21: accepting a host row gives that row', async () => {
    const {answer, pick} = started(fakeEditor());
    pick.accept(pick.items[1] as never);
    deepStrictEqual(await answer, {
      kind: 'host',
      label: 'prod',
      keepVisible: false,
    });
  });

  it('connect-21: accepting the typed row after typing gives the typed row', async () => {
    const {answer, pick} = started(fakeEditor());
    pick.type('lab@h');
    pick.accept(pick.items[2] as never);
    deepStrictEqual(await answer, {
      kind: 'typed',
      label: '➤ lab@h',
      text: 'lab@h',
      keepVisible: true,
    });
  });

  it('F-2301 AC-19: closing the pick without a choice gives nothing', async () => {
    const {answer, pick} = started(fakeEditor());
    pick.hide();
    strictEqual(await answer, undefined);
  });

  it('connect-21: accepting with nothing selected gives nothing', async () => {
    const {answer, pick} = started(fakeEditor());
    pick.selectedItems = [];
    pick.accept(undefined as never);
    strictEqual(await answer, undefined);
  });

  it('connect-21: the pick is disposed once it is hidden', () => {
    const {pick} = started(fakeEditor());
    pick.hide();
    strictEqual(pick.disposals, 1);
  });
});

describe('the opening and the commands of the connect commands (card connect-21)', () => {
  it('connect-21: the host list is the one the adapter was given', () => {
    strictEqual(adapterOf(fakeEditor()).listHosts(), HOSTS);
  });

  it('connect-21: the pick the commands show is the port they were given', async () => {
    const fake = fakeEditor();
    const answer = adapterOf(fake).pickHost(
      pickerModel(HOSTS, '') as never,
      typedText => pickerModel(HOSTS, typedText) as never,
    );
    const pick = fake.picks[0];
    if (pick === undefined) {
      throw new Error('no pick');
    }
    pick.accept(pick.items[1] as never);
    deepStrictEqual(await answer, {
      kind: 'host',
      label: 'prod',
      keepVisible: false,
    });
  });

  it('connect-21: a new window opens an empty window on the authority', async () => {
    const fake = fakeEditor();
    await adapterOf(fake).openRemote('ssh-remote+dev', 'new');
    deepStrictEqual(fake.commandsRun, [
      [
        'vscode.newWindow',
        {remoteAuthority: 'ssh-remote+dev', reuseWindow: false},
      ],
    ]);
  });

  it('connect-21: the current window is reused for the current-window command', async () => {
    const fake = fakeEditor();
    await adapterOf(fake).openRemote('ssh-remote+dev', 'current');
    deepStrictEqual(fake.commandsRun, [
      [
        'vscode.newWindow',
        {remoteAuthority: 'ssh-remote+dev', reuseWindow: true},
      ],
    ]);
  });

  it("connect-21: a refusal of the editor fails the opening with the editor's reason", async () => {
    await rejects(
      Promise.resolve(
        adapterOf(fakeEditor(undefined, new Error('no window'))).openRemote(
          'ssh-remote+dev',
          'new',
        ),
      ),
      {message: 'no window'},
    );
  });

  it('connect-21: a command is run by its id', async () => {
    const fake = fakeEditor();
    await adapterOf(fake).runCommand('opensshremotes.openConfigFile');
    deepStrictEqual(fake.commandsRun, [['opensshremotes.openConfigFile']]);
  });

  it('F-2411 AC-19: the window switches to a local one with the same window and no remote authority', async () => {
    const fake = fakeEditor();
    await adapterOf(fake).switchToLocalWindow();
    deepStrictEqual(fake.commandsRun, [
      ['vscode.newWindow', {reuseWindow: true, remoteAuthority: null}],
    ]);
  });

  it("connect-21: the remote name is the editor's", () => {
    strictEqual(adapterOf(fakeEditor('ssh-remote')).remoteName(), 'ssh-remote');
  });
});

describe('the opener host of the connect commands (card connect-21)', () => {
  it('connect-21: an address is built by the editor from its parts', () => {
    const fake = fakeEditor();
    const parts = {
      scheme: 'vscode-remote',
      authority: 'ssh-remote+dev',
      path: '/',
    };
    deepStrictEqual(
      [openerHostOf(fake.editor).addressOf(parts), fake.addresses],
      [parts, [parts]],
    );
  });

  it('connect-21: a command is run with its parameters', async () => {
    const fake = fakeEditor();
    await openerHostOf(fake.editor).executeCommand('vscode.newWindow', 1, 2);
    deepStrictEqual(fake.commandsRun, [['vscode.newWindow', 1, 2]]);
  });
});
