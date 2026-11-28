import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';

interface Manifest {
  name: string;
  displayName: string;
  description: string;
  publisher: string;
  license: string;
  engines: {vscode: string};
  categories: string[];
  main: string;
  extensionKind: string[];
  capabilities: unknown;
  extensionPack: string[];
  activationEvents: string[];
  enabledApiProposals: string[];
  l10n: string;
  repository: {url: string};
  bugs: {url: string};
  homepage: string;
  dependencies: Record<string, string>;
  contributes: {
    commands: Array<{command: string; title: string; category: string}>;
    menus: Record<
      string,
      Array<{command: string; group?: string; when: string}>
    >;
  };
  [key: string]: unknown;
}

const ROOT = path.join(import.meta.dirname, '..', '..');

/** The JSON file `name` of the package. */
function packageFile(name: string): unknown {
  return JSON.parse(readFileSync(path.join(ROOT, name), 'utf8'));
}

const TEXT = readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const MANIFEST = packageFile('package.json') as Manifest;
const ENGLISH = packageFile('package.nls.json') as Record<string, string>;

/** The English text of a `%key%` reference. */
function english(reference: string): string | undefined {
  return ENGLISH[reference.slice(1, -1)];
}

const STANDING = '!remote-tunnels.standingDown';

const SIX_COMMANDS: Array<[string, string]> = [
  ['remote-tunnels.connectCurrentWindowToTunnel', 'Connect to Tunnel...'],
  ['remote-tunnels.getStarted', 'Get Started with Tunnels'],
  ['remote-tunnels.reportIssue', 'Report Issue...'],
  ['remote-tunnels.settings', 'Settings'],
  ['remote-tunnels.showUsageLimits', 'Show Usage Limits'],
  [
    'remote-tunnels.signIntoTunnelWithDifferentAccount',
    'Sign in to Tunnel with a Different Account',
  ],
];

describe('the manifest of Remote - Tunnels (card #3339)', () => {
  it('F-8001 AC-2, AC-13: lists the six desktop commands with the category Remote-Tunnels and their exact English titles, and no Continue Working command', () => {
    deepStrictEqual(
      MANIFEST.contributes.commands.map(each => [
        each.command,
        `${english(each.category) ?? ''}: ${english(each.title) ?? ''}`,
      ]),
      SIX_COMMANDS.map(([commandId, title]) => [
        commandId,
        `Remote-Tunnels: ${title}`,
      ]),
    );
  });

  it('F-8001 AC-24, F-8101 AC-24: puts Connect to Tunnel... in the remote indicator menu in its group and each of the six in the palette, every entry behind the stand-down key', () => {
    deepStrictEqual(
      [
        MANIFEST.contributes.menus['statusBar/remoteIndicator'],
        MANIFEST.contributes.menus.commandPalette,
        Object.keys(MANIFEST.contributes.menus),
      ],
      [
        [
          {
            command: 'remote-tunnels.connectCurrentWindowToTunnel',
            group: 'remote_10_tunnel_0_local@1',
            when: STANDING,
          },
        ],
        SIX_COMMANDS.map(([commandId]) => ({
          command: commandId,
          when: STANDING,
        })),
        ['statusBar/remoteIndicator', 'commandPalette'],
      ],
    );
  });

  it('F-8001 AC-1, AC-17: has the ten activation events of the reference and nothing else, so no start-up event', () => {
    deepStrictEqual(MANIFEST.activationEvents, [
      'onCommand:remote-tunnels.isConnectedToRemote',
      'onCommand:remote-tunnels.connectNewWindowToTunnel',
      'onCommand:remote-tunnels.internal.isAuthenticated',
      'onCommand:remote-tunnels.internal.getTunnelsList',
      'onCommand:remote-tunnels.internal.getActiveRemote',
      'onCommand:remote-tunnels.internal.getFoldersHistory',
      'onCommand:remote-tunnels.internal.connectToRemote',
      'onCommand:remote-tunnels.internal.deleteFolderFromHistory',
      'onCommand:remote-tunnels.internal.unregisterTunnel',
      'onResolveRemoteAuthority:tunnel',
    ]);
  });

  it('F-8001 AC-20, F-8901 AC-1, AC-7, AC-13: has the identity of the project, the literal display name, one category, the UI kind, the one capability, the one proposal and the family’s explorer as its pack', () => {
    deepStrictEqual(
      [
        `${MANIFEST.publisher}.${MANIFEST.name}`,
        MANIFEST.displayName,
        english(MANIFEST.description),
        MANIFEST.categories,
        MANIFEST.extensionKind,
        MANIFEST.capabilities,
        MANIFEST.enabledApiProposals,
        MANIFEST.extensionPack,
        MANIFEST.license,
        MANIFEST.main,
        MANIFEST.l10n,
      ],
      [
        'remote-oss.remote-server',
        'Remote - Tunnels',
        'Reach your machines from anywhere through a secure tunnel, with nothing to expose and no ports to forward.',
        ['Other'],
        ['ui'],
        {untrustedWorkspaces: {supported: true}},
        ['resolvers'],
        ['remote-oss.remote-explorer'],
        'MIT',
        './dist/extension.js',
        './l10n',
      ],
    );
  });

  it('F-8901 AC-3, AC-6, F-8902 AC-1: points its repository, issues and home at the project, has no telemetry key, no web opener, no browser entry and no command that makes the machine a host', () => {
    const urls = [
      MANIFEST.repository.url,
      MANIFEST.bugs.url,
      MANIFEST.homepage,
    ];
    deepStrictEqual(
      [
        urls.every(each => each.startsWith('https://github.com/remote-oss/')),
        urls.some(each => /microsoft/iu.test(each)),
        MANIFEST.bugs.url,
        'aiKey' in MANIFEST,
        'webOpener' in MANIFEST,
        'browser' in MANIFEST,
        Object.keys(MANIFEST.dependencies),
        MANIFEST.contributes.commands.some(each => /host/iu.test(each.command)),
      ],
      [
        true,
        false,
        'https://github.com/remote-oss/remote/issues',
        false,
        false,
        false,
        ['lib-identifiers', 'lib-standdown'],
        false,
      ],
    );
  });

  it('F-8001 AC-12 (todo: the language texts wait for the user’s decision, #2880): every %key% the manifest names is in the English table, and the engine floor is the family’s', () => {
    const keys = [...TEXT.matchAll(/"%([^%"]+)%"/gu)].map(found => found[1]);
    deepStrictEqual(
      [
        keys.filter(key => key !== undefined && ENGLISH[key] === undefined),
        MANIFEST.engines.vscode,
      ],
      [[], '^1.125.0'],
    );
  });
});
