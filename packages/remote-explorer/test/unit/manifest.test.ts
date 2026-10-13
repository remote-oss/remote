/**
 * @fileoverview The manifest of the package: its identity, activation, proposals, commands, view, menus, string tables
 * and identifiers. Every expected value is written here as a literal.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

const GATE = '!remote-explorer.standingDown';

const LOCALES = [
  'cs',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'pl',
  'pt-br',
  'qps-ploc',
  'ru',
  'tr',
  'zh-cn',
  'zh-tw',
];

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

const STRINGS_TABLE = {
  description:
    'Every remote target in one view: SSH hosts, containers and WSL distros, one click away.',
  'views.remote.title': 'Remotes (Tunnels/SSH)',
  'commands.refresh.title': 'Refresh',
  'commands.connectToRemoteInNewWindow.title': 'Connect in New Window...',
  'commands.connectToRemoteInCurrentWindow.title':
    'Connect in Current Window...',
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

describe('the manifest of the Remote Explorer package', () => {
  it('F-5901.5.identity: the top-level fields are the card, and no other', () => {
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
            ['url']: 'https://github.com/remote-oss/remote.git',
            directory: 'packages/remote-explorer',
          },
          {['url']: 'https://github.com/remote-oss/remote/issues'},
          {vscode: '^1.139.0'},
          ['Other'],
          ['remote development', 'remote', 'explorer'],
        ],
      },
    );
  });

  it('F-5001.AC-15: the one activation event, the UI kind and untrusted workspaces supported, with no virtual-workspace key', () => {
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

  it('F-5001.AC-15: the entry is the built extension file and the runtime strings are in l10n', () => {
    deepStrictEqual(
      [MANIFEST.main, MANIFEST.l10n],
      ['./dist/extension.js', './l10n'],
    );
  });

  it('F-5001.AC-15: the web entry is the web bundle', () => {
    deepStrictEqual(MANIFEST.browser, './dist/web/extension.js');
  });

  it('F-5101.3.3: the proposals are contribViewsRemote and extensionsAny', () => {
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

  it('F-5002.3.1: the three commands, in order, with a title and an icon and no category or enablement', () => {
    deepStrictEqual(CONTRIBUTES.commands, [
      {
        command: 'remote-explorer.refresh',
        title: '%commands.refresh.title%',
        icon: '$(refresh)',
      },
      {
        command: 'remote-explorer.connectToRemoteInNewWindow',
        title: '%commands.connectToRemoteInNewWindow.title%',
        icon: '$(empty-window)',
      },
      {
        command: 'remote-explorer.connectToRemoteInCurrentWindow',
        title: '%commands.connectToRemoteInCurrentWindow.title%',
        icon: '$(arrow-right)',
      },
    ]);
  });

  it('F-5002.AC-1: no command is in the palette', () => {
    deepStrictEqual(MENUS.commandPalette, [
      {command: 'remote-explorer.refresh', when: 'false'},
      {command: 'remote-explorer.connectToRemoteInNewWindow', when: 'false'},
      {
        command: 'remote-explorer.connectToRemoteInCurrentWindow',
        when: 'false',
      },
    ]);
  });

  it('F-5101.3.1: Refresh is the one title entry of the view', () => {
    deepStrictEqual(MENUS['view/title'], [
      {
        command: 'remote-explorer.refresh',
        group: 'navigation',
        when: `view == remoteTargets && ${GATE}`,
      },
    ]);
  });

  it('F-5103.3.1: the two connect commands are inline and in the context menu of the host rows', () => {
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
      [true, true, true, true, true, true, true, true, true],
    );
  });

  it('F-5002.BR-2: the contributions are commands, views and menus, and the menus are three', () => {
    deepStrictEqual(
      [Object.keys(CONTRIBUTES), Object.keys(MENUS)],
      [
        ['commands', 'views', 'menus'],
        ['commandPalette', 'view/title', 'view/item/context'],
      ],
    );
  });

  it('F-5101.3.3: the view is remoteTargets, placed in the targets group for tunnel and SSH windows', () => {
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

  it('F-5001.BR-9: the strings table has the five keys, and the manifest uses only those', () => {
    deepStrictEqual(
      [jsonOf('package.nls.json'), [...new Set(nlsKeysUsed(MANIFEST))].sort()],
      [STRINGS_TABLE, Object.keys(STRINGS_TABLE).sort()],
    );
  });

  it('F-5001.AC-16: the 14 locales have the same keys and the English values', () => {
    deepStrictEqual(
      LOCALES.map(locale => jsonOf(`package.nls.${locale}.json`)),
      LOCALES.map(() => STRINGS_TABLE),
    );
  });

  it('F-5001.AC-16: the runtime strings are the eight texts, in the default bundle and the 14 locales, as English', () => {
    const texts = Object.keys(jsonOf('l10n/bundle.l10n.json'));
    deepStrictEqual(
      [
        texts.length,
        ...LOCALES.map(locale => jsonOf(`l10n/bundle.l10n.${locale}.json`)),
      ],
      [
        8,
        ...LOCALES.map(() =>
          Object.fromEntries(texts.map(text => [text, text])),
        ),
      ],
    );
  });

  it('F-5901.5.identifiers: the identifier inventory is the card', () => {
    deepStrictEqual(jsonOf('identifiers.json'), {
      source: 'remote-oss/remote-explorer#7 (F-5901)',
      standsDownFor: 'ms-vscode.remote-explorer',
      standingDownKey: 'remote-explorer.standingDown',
      namespaces: {
        commands: ['remote-explorer.'],
        settings: ['remote-explorer.'],
        contextKeys: ['remote-explorer.'],
        internalCommands: ['remote-internal.'],
      },
      contextKeys: [{id: 'remote-explorer.standingDown', setter: 'extension'}],
      infoLineCommands: [],
      runtimeCommands: [],
      internal: [
        {
          id: 'remote-internal.setActiveFolders',
          role: 'served',
          kind: 'push',
        },
        {
          id: 'remote-internal.getActiveSshRemote',
          role: 'called',
          kind: 'query',
        },
        {
          id: 'remote-internal.getConfiguredHostnames',
          role: 'called',
          kind: 'query',
        },
        {
          id: 'remote-internal.openRemoteSshTarget',
          role: 'called',
          kind: 'change',
        },
        {id: 'remote-oss.gate.claim', role: 'called', kind: 'query'},
      ],
      invented: [
        {
          id: 'remote-explorer.standingDown',
          kind: 'contextKeys',
          spec: 'F-5001',
          date: '2026-10-13',
        },
      ],
      settingPairs: [],
      ungated: [],
      locales: LOCALES,
    });
  });
});
