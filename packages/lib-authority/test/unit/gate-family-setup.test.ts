import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type * as vscode from 'vscode';
import {
  familySetupPortsOf,
  type FamilySetupOptions,
  runSetup,
} from '../../src/index.ts';

const TEMPLATES: FamilySetupOptions['templates'] = {
  setup: '{0} needs {1} {2}',
  failedAttempt: 'failed {0} {1}',
  restart: 'restart {1}',
  configureButton: 'Configure',
  notNowButton: 'Not Now',
  quitButton: 'Quit {1}',
};

const EXTENSION_ID = 'remote-oss.remote-explorer';

/** Folders a test made, removed after it. */
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, {recursive: true, force: true});
  }
});

/** A folder holding the extension's own manifest, which declares `contribViewsRemote`. */
function extensionFolder(): string {
  const folder = folderOf('family-setup-');
  writeFileSync(
    path.join(folder, 'package.json'),
    '{"enabledApiProposals": ["contribViewsRemote"]}',
  );
  return folder;
}

/** Runs `body` with `VSCODE_PORTABLE` set to `folder`, and restores the variable after. */
async function withPortable(
  folder: string,
  body: () => Promise<void>,
): Promise<void> {
  const before = process.env.VSCODE_PORTABLE;
  process.env.VSCODE_PORTABLE = folder;
  try {
    await body();
  } finally {
    if (before === undefined) {
      delete process.env.VSCODE_PORTABLE;
    } else {
      process.env.VSCODE_PORTABLE = before;
    }
  }
}

/** A new folder, removed after the test. */
function folderOf(prefix: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
}

/** What the fake editor showed. */
interface Shown {
  warnings: string[];
  informations: string[];
  /** The buttons of each message shown, in the order shown. */
  buttons: string[][];
}

function fakeEditor(commands: string[], shown: Shown, extensionPath: string) {
  return {
    env: {appName: 'VSCodium', appCommit: undefined},
    workspace: {
      tunnels: Promise.resolve([]),
      onDidSaveTextDocument: () => ({dispose: () => undefined}),
      onDidCloseTextDocument: () => ({dispose: () => undefined}),
    },
    window: {
      onDidWriteTerminalData: () => ({dispose: () => undefined}),
      showWarningMessage: (text: string, ...buttons: string[]) => {
        shown.warnings.push(text);
        shown.buttons.push(buttons);
        return Promise.resolve(undefined);
      },
      showInformationMessage: (text: string, ...buttons: string[]) => {
        shown.informations.push(text);
        shown.buttons.push(buttons);
        return Promise.resolve(undefined);
      },
    },
    commands: {
      getCommands: () => Promise.resolve(commands),
      registerCommand: () => ({dispose: () => undefined}),
      executeCommand: () => Promise.resolve(EXTENSION_ID),
    },
    extensions: {all: [{id: EXTENSION_ID, extensionPath}]},
  } as unknown as typeof vscode;
}

function contextOf(): Pick<
  vscode.ExtensionContext,
  'globalState' | 'subscriptions' | 'extension'
> {
  const stored = new Map<string, unknown>();
  return {
    globalState: {
      keys: () => [...stored.keys()],
      get: (key: string) => stored.get(key) as never,
      update: (key: string, value: unknown) => {
        stored.set(key, value);
        return Promise.resolve();
      },
      setKeysForSync: () => undefined,
    },
    subscriptions: [],
    extension: {id: EXTENSION_ID} as unknown as vscode.Extension<unknown>,
  };
}

function optionsOf(
  changes: Partial<FamilySetupOptions> = {},
): FamilySetupOptions {
  return {
    displayName: 'Remote Explorer',
    proposals: ['contribViewsRemote'],
    viewIds: ['remoteTargets'],
    templates: TEMPLATES,
    translate: template => template,
    dataFolderName: () => Promise.resolve('.vscode-oss'),
    logFailure: () => undefined,
    ...changes,
  };
}

/** A record of what the editor showed, with nothing shown yet. */
function newShown(): Shown {
  return {warnings: [], informations: [], buttons: []};
}

/** The setup's ports over a fake editor that lists `commands` and shows to `shown`. */
function portsOf(
  changes: Partial<FamilySetupOptions> = {},
  shown: Shown = newShown(),
  commands: string[] = [],
): ReturnType<typeof familySetupPortsOf> {
  return familySetupPortsOf(
    fakeEditor(commands, shown, extensionFolder()),
    contextOf(),
    optionsOf(changes),
  );
}

describe('the family setup over the editor (card explorer-03b)', () => {
  it('contracts.3.4: the views of the extension are probed through their focus commands, granted', async () => {
    const ports = portsOf({}, newShown(), ['remoteTargets.focus']);
    deepStrictEqual(await ports.probe(), [
      {proposal: 'contribViewsRemote', state: 'granted'},
    ]);
  });

  it('contracts.3.4: without the focus command the proposal is missing', async () => {
    const ports = portsOf();
    deepStrictEqual(await ports.probe(), [
      {proposal: 'contribViewsRemote', state: 'missing'},
    ]);
  });

  it('contracts.3.4: a setup notice is the translated template, filled with the extension and the editor', async () => {
    const shown = newShown();
    const outcome = await runSetup(
      portsOf({translate: template => `T:${template}`}, shown),
      true,
    );
    await outcome.interaction;
    deepStrictEqual(shown.warnings, [
      "T:Remote Explorer needs VSCodium 'remote-oss.remote-explorer'",
    ]);
  });

  it("contracts.3.4: each of the six texts is the extension's template through its translate", async () => {
    const shown = newShown();
    const ports = portsOf({translate: template => `T:${template}`}, shown);
    await ports.showSetup({kind: 'setup', argvEntries: ['one']});
    await ports.showSetup({kind: 'failedAttempt'});
    await ports.showRestart();
    deepStrictEqual(
      [shown.warnings, shown.informations, shown.buttons],
      [
        [
          "T:Remote Explorer needs VSCodium 'one'",
          'T:failed Remote Explorer VSCodium',
        ],
        ['T:restart VSCodium'],
        [
          ['T:Configure', 'T:Not Now'],
          ['T:Configure', 'T:Not Now'],
          ['T:Quit VSCodium'],
        ],
      ],
    );
  });

  it("contracts.3.4: the failure the setup reports goes to the extension's own log", () => {
    const failures: string[] = [];
    const ports = portsOf({logFailure: message => failures.push(message)});
    ports.logFailure('the setup failed');
    deepStrictEqual(failures, ['the setup failed']);
  });

  it('contracts.3.4: the runtime arguments of a portable install are read from its folder', async () => {
    const portable = folderOf('family-argv-');
    writeFileSync(
      path.join(portable, 'argv.json'),
      `{"enable-proposed-api": ["${EXTENSION_ID}"]}`,
    );
    await withPortable(portable, async () => {
      deepStrictEqual(await portsOf().argvEnabled(), [EXTENSION_ID]);
    });
  });

  it('contracts.3.4: with no runtime-arguments file nothing is enabled and no failure is logged', async () => {
    const failures: string[] = [];
    await withPortable(folderOf('family-argv-'), async () => {
      const ports = portsOf({logFailure: message => failures.push(message)});
      deepStrictEqual([await ports.argvEnabled(), failures], [[], []]);
    });
  });

  it('contracts.3.4: the restart notice, when the arguments already list the extension, is shown through the editor', async () => {
    const portable = folderOf('family-argv-');
    writeFileSync(
      path.join(portable, 'argv.json'),
      `{"enable-proposed-api": ["${EXTENSION_ID}"]}`,
    );
    const shown = newShown();
    await withPortable(portable, async () => {
      const outcome = await runSetup(portsOf({}, shown), true);
      await outcome.interaction;
    });
    deepStrictEqual(shown.informations.length + shown.warnings.length, 1);
  });

  it('contracts.3.4: notices given by the extension are the ones shown', async () => {
    const shown = newShown();
    const given: string[] = [];
    const outcome = await runSetup(
      portsOf(
        {
          notices: {
            showWarning: text => {
              given.push(text);
              return Promise.resolve(undefined);
            },
            showInformation: () => Promise.resolve(undefined),
          },
        },
        shown,
      ),
      true,
    );
    await outcome.interaction;
    deepStrictEqual([given.length, shown.warnings], [1, []]);
  });
});
