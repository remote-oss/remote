/**
 * @fileoverview The manifest of the package: its identity, activation, proposals, commands, view, menus, string tables
 * and identifiers. Every expected value is written here as a literal.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

const GATE = '!remote-explorer.standingDown';

/** Whether none of the keys names telemetry, case-insensitively. */
function noTelemetryKey(keys: string[]): boolean {
  return keys.every(key => !/telemetry/i.test(key));
}

/** A JSON file of the package. */
function jsonOf(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(PACKAGE, file), 'utf8')) as Record<
    string,
    unknown
  >;
}

const MANIFEST = jsonOf('package.json');

const CONTRIBUTES = (MANIFEST.contributes ?? {}) as Record<string, unknown>;

const MENUS = (CONTRIBUTES.menus ?? {}) as Record<string, unknown[]>;

const CLAUSE = `viewItem == remote-explorer.tunnelRemoteTarget && ${GATE} || viewItem == remote-explorer.sshRemoteTarget && ${GATE}`;

const FOLDER_CLAUSE = `viewItem == remote-explorer.remoteFolder && ${GATE} || viewItem == remote-explorer.tunnelWsl && ${GATE}`;

const GROUP_CLAUSE = `viewItem == remote-explorer.sshGroup && ${GATE}`;

const REMOVE_CLAUSE = `viewItem == remote-explorer.remoteFolder && ${GATE}`;

const STRINGS_TABLE = {
  description:
    'Every remote target in one view: SSH hosts, containers and WSL distros, one click away.',
  'views.remote.title': 'Remotes (Tunnels/SSH)',
  'commands.refresh.title': 'Refresh',
  'commands.connectToRemoteInNewWindow.title': 'Connect in New Window...',
  'commands.connectToRemoteInCurrentWindow.title':
    'Connect in Current Window...',
  'commands.connectToFolderInNewWindow.title': 'Connect in New Window...',
  'commands.connectToFolderInCurrentWindow.title':
    'Connect in Current Window...',
  'commands.deleteFolderHistoryItem.title': 'Remove from Recent List',
  'configuration.title': 'Remote Explorer',
  'settings.foldersSortOrder.description':
    'Specifies the order in which to display folders under Remote targets in the Remote Explorer.',
  'settings.foldersSortOrder.mru.description':
    'Display folders in order of the most recently opened at the top',
  'settings.foldersSortOrder.alphabetical.description':
    'Display folders in alphabetical order',
  'settings.collapseRecentFolders.description':
    'Collapse the recent folders under Remote targets in the Remote Explorer.',
  'commands.configureSsh.title': 'Open SSH Config File',
  'commands.add.title': 'New Remote',
};

/** Every `%key%` the manifest uses. */
function nlsKeysUsed(manifest: unknown): string[] {
  return [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map(
    match => match[1] ?? '',
  );
}

/** The top-level alternatives of a `when` clause, split on `||`. */
function alternativesOf(when: unknown): string[] {
  return String(when)
    .split(' || ')
    .map(each => each.trim());
}

/** An address of Microsoft's: its sites, its short links, or the reference extensions' repositories. */
const MICROSOFT_ADDRESS =
  /microsoft\.com|aka\.ms|visualstudio\.com|Microsoft\/vscode/i;

/** The manifest, the string bundles and the README, each as its text. */
function addressedTexts(): string[] {
  return readdirSync(PACKAGE)
    .filter(file => /^(package(\.nls.*)?\.json|README\.md)$/.test(file))
    .map(file => readFileSync(path.join(PACKAGE, file), 'utf8'));
}

describe('the manifest of the Remote Explorer package', () => {
  it('F-5901 AC-3 (ruling-d56): the repository and bugs are the monorepo’s, as the pack’s and the other members’ are, and no address in the manifest, the bundles or the README is Microsoft’s', () => {
    deepStrictEqual(
      [
        MANIFEST.repository,
        MANIFEST.bugs,
        addressedTexts().filter(text => MICROSOFT_ADDRESS.test(text)),
      ],
      [
        {
          type: 'git',
          url: 'https://github.com/remote-oss/remote.git',
          directory: 'packages/remote-explorer',
        },
        {url: 'https://github.com/remote-oss/remote/issues'},
        [],
      ],
    );
  });

  it('F-5001.AC-18, F-5901.AC-1: F-5901.5.identity: the top-level fields are the card, and no other', () => {
    deepStrictEqual(
      {
        keys: Object.keys(MANIFEST),
        identity: [
          MANIFEST.name,
          MANIFEST.displayName,
          MANIFEST.description,
          MANIFEST.version,
          MANIFEST.publisher,
          MANIFEST.private,
          MANIFEST.license,
          MANIFEST.repository,
          MANIFEST.bugs,
          MANIFEST.engines,
          MANIFEST.categories,
          MANIFEST.keywords,
        ],
      },
      {
        keys: [
          'name',
          'displayName',
          'description',
          'version',
          'publisher',
          'private',
          'license',
          'repository',
          'bugs',
          'engines',
          'categories',
          'main',
          'browser',
          'keywords',
          'extensionKind',
          'capabilities',
          'activationEvents',
          'enabledApiProposals',
          'l10n',
          'contributes',
          'dependencies',
        ],
        identity: [
          'remote-explorer',
          'Remote Explorer',
          '%description%',
          '0.1.0',
          'remote-oss',
          true,
          'MIT',
          {
            type: 'git',
            url: 'https://github.com/remote-oss/remote.git',
            directory: 'packages/remote-explorer',
          },
          {url: 'https://github.com/remote-oss/remote/issues'},
          {vscode: '^1.125.0'},
          ['Other'],
          ['remote development', 'remote', 'explorer'],
        ],
      },
    );
  });

  it('F-5001.AC-15, F-5902.AC-1: the one activation event, the UI kind and untrusted workspaces supported, with no virtual-workspace key', () => {
    deepStrictEqual(
      [
        MANIFEST.activationEvents,
        MANIFEST.extensionKind,
        MANIFEST.capabilities,
      ],
      [
        ['onCommand:remote-internal.setActiveFolders'],
        ['ui'],
        {untrustedWorkspaces: {supported: true}},
      ],
    );
  });

  it('F-5001.AC-15, F-5901.AC-11: the entry is the built extension file and the runtime strings are in l10n', () => {
    deepStrictEqual(
      [MANIFEST.main, MANIFEST.l10n],
      ['./dist/extension.js', './l10n'],
    );
  });

  it('F-5001.AC-15: the web entry is the web bundle', () => {
    deepStrictEqual(MANIFEST.browser, './dist/web/extension.js');
  });

  it('F-5901.AC-12: F-5101.3.3: the proposals are contribViewsRemote and extensionsAny', () => {
    deepStrictEqual(MANIFEST.enabledApiProposals, [
      'contribViewsRemote',
      'extensionsAny',
    ]);
  });

  it('F-5101.AC-42: the package declares no extension pack and no extension dependency', () => {
    deepStrictEqual(
      ['extensionPack', 'extensionDependencies'].map(key => key in MANIFEST),
      [false, false],
    );
  });

  it('F-5103.AC-1, F-5902.AC-1, AC-14: F-5002.3.1: the commands of the card are contributed with their title and icon, and every command has a title and an icon and no category or enablement', () => {
    const required: Array<[string, string]> = [
      ['refresh', '$(refresh)'],
      ['connectToRemoteInNewWindow', '$(empty-window)'],
      ['connectToRemoteInCurrentWindow', '$(arrow-right)'],
      ['connectToFolderInNewWindow', '$(empty-window)'],
      ['connectToFolderInCurrentWindow', '$(arrow-right)'],
      ['deleteFolderHistoryItem', '$(remove)'],
      ['configureSsh', '$(gear)'],
      ['add', '$(plus)'],
    ];
    const commands = (CONTRIBUTES.commands ?? []) as Array<
      Record<string, unknown>
    >;
    deepStrictEqual(
      {
        missing: required.filter(
          ([name, icon]) =>
            !commands.some(
              entry =>
                JSON.stringify(entry) ===
                JSON.stringify({
                  command: `remote-explorer.${name}`,
                  title: `%commands.${name}.title%`,
                  icon,
                }),
            ),
        ),
        incomplete: commands
          .filter(
            entry =>
              typeof entry.title !== 'string' ||
              typeof entry.icon !== 'string' ||
              'category' in entry ||
              'enablement' in entry,
          )
          .map(entry => entry.command),
      },
      {missing: [], incomplete: []},
    );
  });

  it('F-5002.AC-1, AC-2, F-5101.AC-8, F-5103.AC-3: no command is in the palette', () => {
    deepStrictEqual(MENUS.commandPalette, [
      {command: 'remote-explorer.refresh', when: 'false'},
      {command: 'remote-explorer.connectToRemoteInNewWindow', when: 'false'},
      {
        command: 'remote-explorer.connectToRemoteInCurrentWindow',
        when: 'false',
      },
      {command: 'remote-explorer.connectToFolderInNewWindow', when: 'false'},
      {
        command: 'remote-explorer.connectToFolderInCurrentWindow',
        when: 'false',
      },
      {command: 'remote-explorer.deleteFolderHistoryItem', when: 'false'},
      {command: 'remote-explorer.configureSsh', when: 'false'},
      {command: 'remote-explorer.add', when: 'false'},
    ]);
  });

  it('F-5001.AC-24, F-5101.AC-7: F-5101.3.1: Refresh is the one title entry of the view', () => {
    deepStrictEqual(MENUS['view/title'], [
      {
        command: 'remote-explorer.refresh',
        group: 'navigation',
        when: `view == remoteTargets && ${GATE}`,
      },
    ]);
  });

  it('F-5001.AC-24, F-5103.AC-1, AC-8, AC-26: F-5103.3.1: the connect commands are inline and in the context menu of the host and folder rows, the removal is in the menu of the folder rows, and the two hand-overs are inline and in the menu of the SSH group row', () => {
    deepStrictEqual(MENUS['view/item/context'], [
      {
        command: 'remote-explorer.connectToRemoteInCurrentWindow',
        group: 'inline@1',
        when: CLAUSE,
      },
      {
        command: 'remote-explorer.connectToRemoteInCurrentWindow',
        group: 'navigation@1',
        when: CLAUSE,
      },
      {
        command: 'remote-explorer.connectToRemoteInNewWindow',
        group: 'inline@2',
        when: CLAUSE,
      },
      {
        command: 'remote-explorer.connectToRemoteInNewWindow',
        group: 'navigation@2',
        when: CLAUSE,
      },
      {
        command: 'remote-explorer.connectToFolderInCurrentWindow',
        group: 'inline@1',
        when: FOLDER_CLAUSE,
      },
      {
        command: 'remote-explorer.connectToFolderInCurrentWindow',
        group: 'navigation@1',
        when: FOLDER_CLAUSE,
      },
      {
        command: 'remote-explorer.connectToFolderInNewWindow',
        group: 'inline@2',
        when: FOLDER_CLAUSE,
      },
      {
        command: 'remote-explorer.connectToFolderInNewWindow',
        group: 'navigation@2',
        when: FOLDER_CLAUSE,
      },
      {
        command: 'remote-explorer.deleteFolderHistoryItem',
        group: 'navigation@3',
        when: REMOVE_CLAUSE,
      },
      {
        command: 'remote-explorer.configureSsh',
        group: 'inline@1',
        when: GROUP_CLAUSE,
      },
      {
        command: 'remote-explorer.configureSsh',
        group: 'navigation@1',
        when: GROUP_CLAUSE,
      },
      {
        command: 'remote-explorer.add',
        group: 'inline@2',
        when: GROUP_CLAUSE,
      },
      {
        command: 'remote-explorer.add',
        group: 'navigation@2',
        when: GROUP_CLAUSE,
      },
    ]);
  });

  it('F-5901.5.gating: every alternative of every view menu clause ends with the stand-down key, named once', () => {
    deepStrictEqual(
      [
        ...(MENUS['view/title'] ?? []),
        ...(MENUS['view/item/context'] ?? []),
      ].flatMap(entry =>
        alternativesOf((entry as {when: string}).when).map(
          alternative =>
            alternative.endsWith(` && ${GATE}`) &&
            alternative.split(GATE).length === 2,
        ),
      ),
      Array.from({length: 22}, () => true),
    );
  });

  it('F-5002.BR-2: the contributions are commands, views, menus and configuration, and the menus are three', () => {
    deepStrictEqual(
      [Object.keys(CONTRIBUTES), Object.keys(MENUS)],
      [
        ['commands', 'views', 'menus', 'configuration'],
        ['commandPalette', 'view/title', 'view/item/context'],
      ],
    );
  });

  it('F-5104.BR-5, BR-7: the two settings are application-scoped, with the defaults and the sort order choices', () => {
    deepStrictEqual(CONTRIBUTES.configuration, {
      title: '%configuration.title%',
      properties: {
        'remote-explorer.foldersSortOrder': {
          type: 'string',
          default: 'most recently used',
          scope: 'application',
          enum: ['most recently used', 'alphabetical'],
          enumDescriptions: [
            '%settings.foldersSortOrder.mru.description%',
            '%settings.foldersSortOrder.alphabetical.description%',
          ],
          description: '%settings.foldersSortOrder.description%',
        },
        'remote-explorer.collapseRecentFolders': {
          type: 'boolean',
          default: false,
          scope: 'application',
          description: '%settings.collapseRecentFolders.description%',
        },
      },
    });
  });

  it('F-5101.AC-1: F-5101.3.3: the view is remoteTargets, placed in the targets group for tunnel and SSH windows', () => {
    deepStrictEqual(CONTRIBUTES.views, {
      remote: [
        {
          id: 'remoteTargets',
          name: '%views.remote.title%',
          group: 'targets@1',
          remoteName: ['tunnel', 'ssh-remote'],
        },
      ],
    });
  });

  it('F-5001.BR-9: the strings table holds the card’s keys with their texts, and the manifest uses every key the table holds', () => {
    const table = jsonOf('package.nls.json');
    const used = new Set(nlsKeysUsed(MANIFEST));
    deepStrictEqual(
      {
        wrong: Object.entries(STRINGS_TABLE).filter(
          ([key, text]) => table[key] !== text,
        ),
        unused: Object.keys(table).filter(key => !used.has(key)),
      },
      {wrong: [], unused: []},
    );
  });

  it('F-5001.AC-16, F-5901.AC-11: every locale of identifiers.json has a table and a runtime bundle with the English values', () => {
    const locales = (jsonOf('identifiers.json').locales ?? []) as string[];
    const english = jsonOf('package.nls.json');
    const texts = Object.keys(jsonOf('l10n/bundle.l10n.json'));
    deepStrictEqual(
      locales.map(locale => [
        jsonOf(`package.nls.${locale}.json`),
        jsonOf(`l10n/bundle.l10n.${locale}.json`),
      ]),
      locales.map(() => [
        english,
        Object.fromEntries(texts.map(text => [text, text])),
      ]),
    );
  });

  it('F-5901.5.identifiers: the identifier inventory has the card’s source, stand-down key, namespaces, context key, internal commands and invented identifier', () => {
    const inventory = jsonOf('identifiers.json');
    const internal = (inventory.internal ?? []) as Array<{id: string}>;
    const required = [
      {id: 'remote-internal.setActiveFolders', role: 'served', kind: 'push'},
      {
        id: 'remote-internal.sshHostsChanged',
        role: 'served',
        kind: 'push',
        activates: false,
      },
      {id: 'remote-internal.getActiveSshRemote', role: 'called', kind: 'query'},
      {
        id: 'remote-internal.getConfiguredHostnames',
        role: 'called',
        kind: 'query',
      },
      {
        id: 'remote-internal.getSshFoldersHistory',
        role: 'called',
        kind: 'query',
      },
      {
        id: 'remote-internal.openRemoteSshTarget',
        role: 'called',
        kind: 'change',
      },
      {
        id: 'remote-internal.deleteSshFolderFromHistory',
        role: 'called',
        kind: 'change',
      },
      {id: 'remote-oss.gate.claim', role: 'called', kind: 'query'},
    ];
    deepStrictEqual(
      {
        identity: [
          inventory.source,
          inventory.standsDownFor,
          inventory.standingDownKey,
          inventory.namespaces,
        ],
        contextKeys: inventory.contextKeys,
        missingInternal: required.filter(
          entry =>
            JSON.stringify(internal.find(each => each.id === entry.id)) !==
            JSON.stringify(entry),
        ),
        invented: inventory.invented,
      },
      {
        identity: [
          'remote-oss/remote-explorer#7 (F-5901)',
          'ms-vscode.remote-explorer',
          'remote-explorer.standingDown',
          {
            commands: ['remote-explorer.'],
            settings: ['remote-explorer.'],
            contextKeys: ['remote-explorer.'],
            internalCommands: ['remote-internal.'],
          },
        ],
        contextKeys: [
          {id: 'remote-explorer.standingDown', setter: 'extension'},
        ],
        missingInternal: [],
        invented: [
          {
            id: 'remote-explorer.standingDown',
            kind: 'contextKeys',
            spec: 'F-5001',
            date: '2026-10-13',
          },
        ],
      },
    );
  });

  it('F-5901 AC-7: the package declares no telemetry: no telemetry.json, and no telemetry key in the manifest', () => {
    deepStrictEqual(
      [
        existsSync(path.join(PACKAGE, 'telemetry.json')),
        noTelemetryKey(Object.keys(MANIFEST)),
        noTelemetryKey(Object.keys(CONTRIBUTES)),
      ],
      [false, true, true],
    );
  });

  it("F-5901 AC-13: the package ships the repository's MIT licence", () => {
    const root = path.join(PACKAGE, '..', '..');
    const licence = readFileSync(path.join(PACKAGE, 'LICENSE'), 'utf8');
    const rootLicence = readFileSync(path.join(root, 'LICENSE'), 'utf8');
    const ignore = readFileSync(
      path.join(PACKAGE, '.vscodeignore'),
      'utf8',
    ).split('\n');
    deepStrictEqual(
      [
        licence === rootLicence,
        licence.startsWith('MIT License'),
        licence.includes('Microsoft'),
        ignore.includes('!LICENSE'),
      ],
      [true, true, false, true],
    );
  });

  it("F-5901 AC-14 (ruling-737-readme): the README says it collects no telemetry, that it stands down beside another Remote Explorer, and to install it directly, naming no other publisher's id", () => {
    const readme = readFileSync(path.join(PACKAGE, 'README.md'), 'utf8')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const bullets = [
      '- Remote Explorer collects no telemetry.',
      "- Running it beside another Remote Explorer extension isn't supported: when one is installed and enabled, this one stands down and shows a warning.",
      "- Extension packs that list another Remote Explorer extension don't install this one. Install it directly.",
    ];
    deepStrictEqual(
      [
        ...bullets.map(bullet => readme.includes(bullet.toLowerCase())),
        readme.includes('ms-vscode'),
        readme.includes('microsoft'),
      ],
      [true, true, true, false, false],
    );
  });
});
