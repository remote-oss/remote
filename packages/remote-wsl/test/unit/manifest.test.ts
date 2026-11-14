import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';

/** A contribution entry that may carry a `when` clause. */
interface Gated {
  readonly command?: string;
  readonly id?: string;
  readonly when?: string;
}

interface Manifest {
  readonly publisher: string;
  readonly name: string;
  readonly extensionKind: readonly string[];
  readonly engines: {readonly vscode: string};
  readonly activationEvents: readonly string[];
  readonly enabledApiProposals: readonly string[];
  readonly capabilities: unknown;
  readonly main: string;
  readonly browser: string;
  readonly extensionPack?: unknown;
  readonly extensionDependencies?: unknown;
  readonly contributes: {
    readonly commands: ReadonlyArray<{command: string; category: string}>;
    readonly configuration: {
      readonly title: string;
      readonly properties: Readonly<Record<string, unknown>>;
    };
    readonly views: Readonly<Record<string, readonly Gated[]>>;
    readonly menus: Readonly<Record<string, readonly Gated[]>>;
    readonly keybindings: readonly Gated[];
    readonly viewsWelcome?: unknown;
  };
}

const ROOT = path.join(import.meta.dirname, '..', '..');
const TEXT = readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const MANIFEST = JSON.parse(TEXT) as Manifest;
const ENGLISH_TEXTS = JSON.parse(
  readFileSync(path.join(ROOT, 'package.nls.json'), 'utf8'),
) as Readonly<Record<string, string>>;

/** Every gated entry of the manifest: menus, views, key bindings. */
function gatedEntries(): Gated[] {
  const {menus, views, keybindings} = MANIFEST.contributes;
  return [
    ...Object.values(menus).flat(),
    ...Object.values(views).flat(),
    ...keybindings,
  ];
}

/** The text a `%key%` reference reads in English. */
function english(reference: string): string | undefined {
  return ENGLISH_TEXTS[reference.replace(/^%|%$/gu, '')];
}

describe('the WSL manifest (wsl.package)', () => {
  it('declares the identity, the floor, the kind, the capabilities, the two entries and the four activation events', () => {
    deepStrictEqual(
      {
        id: `${MANIFEST.publisher}.${MANIFEST.name}`,
        extensionKind: MANIFEST.extensionKind,
        engines: MANIFEST.engines.vscode,
        capabilities: MANIFEST.capabilities,
        main: MANIFEST.main,
        browser: MANIFEST.browser,
        activationEvents: MANIFEST.activationEvents,
      },
      {
        id: 'remote-oss.remote-wsl',
        extensionKind: ['ui'],
        engines: '^1.125.0',
        capabilities: {
          virtualWorkspaces: true,
          untrustedWorkspaces: {supported: true},
        },
        main: './dist/extension.js',
        browser: './dist/web/extension.js',
        activationEvents: [
          'onStartupFinished',
          'onResolveRemoteAuthority:wsl',
          'onCommand:remote-wsl.newWindow',
          'onCommand:remote-wsl.newWindowForDistro',
        ],
      },
    );
  });

  it('enables exactly the three proposals and never telemetry, and bundles or depends on no other extension', () => {
    deepStrictEqual(
      {
        proposals: [...MANIFEST.enabledApiProposals].sort(),
        pack: MANIFEST.extensionPack,
        dependencies: MANIFEST.extensionDependencies,
      },
      {
        proposals: ['contribRemoteHelp', 'contribViewsRemote', 'resolvers'],
        pack: undefined,
        dependencies: undefined,
      },
    );
  });

  it("names no other publisher's extension anywhere", () => {
    deepStrictEqual(/"ms-vscode(-remote)?\./u.test(TEXT), false);
  });

  it('contributes the 23 commands, all under WSL but Reveal in File Explorer under File, and the nine settings under the title WSL', () => {
    const {commands, configuration} = MANIFEST.contributes;
    deepStrictEqual(
      {
        commands: commands.length,
        categories: commands
          .map(each => `${each.command} ${String(english(each.category))}`)
          .filter(each => !each.endsWith(' WSL')),
        title: configuration.title,
        settings: Object.keys(configuration.properties).sort(),
      },
      {
        commands: 23,
        categories: ['remote-wsl.revealInExplorer File'],
        title: 'WSL',
        settings: [
          'remote.WSL.debug',
          'remote.WSL.downloadInBackground',
          'remote.WSL.experimental.scriptLessStartup',
          'remote.WSL.fileWatcher.polling',
          'remote.WSL.fileWatcher.pollingInterval',
          'remote.WSL.serverDownloadUrlTemplate',
          'remote.WSL.useShellEnvironment',
          'remote.WSL1.connectionMethod',
          'remote.WSL2.connectionMethod',
        ],
      },
    );
  });

  it('gates every menu item, view and key binding: the condition in parentheses then the stand-down key, the bare key, or hidden', () => {
    const gate = /^\(.+\) && !wsl\.standingDown$|^!wsl\.standingDown$|^false$/u;
    deepStrictEqual(
      gatedEntries()
        .filter(each => !gate.test(each.when ?? ''))
        .map(each => `${each.command ?? each.id ?? '?'}: ${each.when ?? ''}`),
      [],
    );
  });

  it('shows Show Log in the palette everywhere and in the remote indicator only in a WSL window', () => {
    const {menus} = MANIFEST.contributes;
    function showLog(menu: string): string | undefined {
      return menus[menu]?.find(each => each.command === 'remote-wsl.showLog')
        ?.when;
    }
    deepStrictEqual(
      [showLog('commandPalette'), showLog('statusBar/remoteIndicator')],
      ['!wsl.standingDown', '(remoteName == wsl) && !wsl.standingDown'],
    );
  });

  it('declares no view-welcome content yet', () => {
    deepStrictEqual(MANIFEST.contributes.viewsWelcome, undefined);
  });
});
