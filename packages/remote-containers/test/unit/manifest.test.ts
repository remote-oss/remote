/**
 * @fileoverview The manifest of the package: its identity, activation, proposals, capabilities, string tables and
 * identifiers. Every expected value is written here as a literal.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

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

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(PACKAGE, file), 'utf8')) as Record<
    string,
    unknown
  >;
}

const MANIFEST = readJson('package.json');

/** The `when` clause of the command's palette entry and menu entry. */
/** The `when` clause of the in-container rebuild commands. */
const REBUILD_WHEN =
  '!hideRebuildCommands && remoteName =~ /^dev-container$/ && !remote-containers:standingDown';

const REOPEN_WHEN =
  '!hideConnectCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && isWorkspaceTrusted && !remote-containers:standingDown';

const ENGLISH = {
  description:
    'Develop inside a container that carries its own toolchain, so each project brings its environment with it.',
  'capabilities.untrustedWorkspaces.description':
    'Opening a folder in a container requires workspace trust.',
  'configuration.title': 'Dev Containers',
  'commands.Reopenincontainer.title': 'Reopen in Container',
  'commands.Rebuildcontainer.title': 'Rebuild Container',
  'commands.Rebuildcontainerwithoutcache.title':
    'Rebuild Container Without Cache',
  'setting.Dockerpath.description':
    'Docker (or Podman or WSLc) executable name or path.',
  'setting.ServerDownloadBaseUrl.description':
    'Base URL for downloading the VS Code server. The path `/commit:{commit}/server-{platform}/{quality}` will be appended to this URL. Platforms include `linux-x64`, `linux-armhf`, `linux-arm64`, `linux-alpine`, and `alpine-arm64`. Quality is `stable` or `insider`.',
  'setting.ServerDownloadBaseUrl.patternError':
    'Must be a URL (e.g., https://example.com or https://example.com:8080/path).',
  'setting.ServerDownloadFolder.description':
    "Local folder for downloading and caching VS Code server archives. The archives will be stored as `{downloadFolder}/{commit}/vscode-server-{platform}[-{quality}].tar.gz`. Platforms include `linux-x64`, `linux-armhf`, `linux-arm64`, `linux-alpine`, and `alpine-arm64`. Quality is `stable` or `insider`. The `-{quality}` suffix is omitted for `stable`. The default is in the system's temp folder.",
  'setting.CacheVolume.description':
    'Controls whether a Docker volume should be used to cache the VS Code server and extensions.',
  'setting.CacheVolume.deprecated':
    'Use `#dev.containers.cacheVolume#` instead.',
};

describe('the manifest', () => {
  it('F-0101 AC-4: the identity is ours, field by field, and the key set is exactly the declared one', () => {
    deepStrictEqual(MANIFEST, {
      name: 'remote-containers',
      displayName: 'Dev Containers',
      description: '%description%',
      version: '0.1.0',
      publisher: 'remote-oss',
      private: true,
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'https://github.com/remote-oss/remote.git',
        directory: 'packages/remote-containers',
      },
      bugs: {url: 'https://github.com/remote-oss/remote/issues'},
      engines: {vscode: '^1.139.0'},
      categories: ['Other'],
      main: './dist/extension.js',
      keywords: [
        'remote development',
        'remote',
        'containers',
        'docker',
        'devcontainer',
      ],
      extensionKind: ['ui'],
      capabilities: {
        virtualWorkspaces: true,
        untrustedWorkspaces: {
          supported: 'limited',
          description: '%capabilities.untrustedWorkspaces.description%',
        },
      },
      activationEvents: ['onResolveRemoteAuthority:dev-container'],
      enabledApiProposals: [
        'resolvers',
        'tunnels',
        'workspaceTrust',
        'terminalDimensions',
        'contribEditSessions',
        'contribViewsRemote',
        'contribRemoteHelp',
      ],
      l10n: './l10n',
      contributes: {
        commands: [
          {
            command: 'remote-containers.reopenInContainer',
            title: '%commands.Reopenincontainer.title%',
            category: 'Dev Containers',
          },
          {
            command: 'remote-containers.rebuildContainer',
            title: '%commands.Rebuildcontainer.title%',
            category: 'Dev Containers',
          },
          {
            command: 'remote-containers.rebuildContainerNoCache',
            title: '%commands.Rebuildcontainerwithoutcache.title%',
            category: 'Dev Containers',
          },
        ],
        menus: {
          commandPalette: [
            {
              command: 'remote-containers.reopenInContainer',
              when: REOPEN_WHEN,
            },
            {
              command: 'remote-containers.rebuildContainer',
              when: REBUILD_WHEN,
            },
            {
              command: 'remote-containers.rebuildContainerNoCache',
              when: REBUILD_WHEN,
            },
          ],
          'statusBar/remoteIndicator': [
            {
              command: 'remote-containers.reopenInContainer',
              group: 'remote_30_dev-container_2_actions@8',
              when: REOPEN_WHEN,
            },
            {
              command: 'remote-containers.rebuildContainer',
              group: 'remote_30_dev-container_2_actions@5',
              when: REBUILD_WHEN,
            },
          ],
        },
        configuration: {
          title: '%configuration.title%',
          properties: {
            'dev.containers.dockerPath': {
              type: 'string',
              default: 'docker',
              scope: 'application',
              description: '%setting.Dockerpath.description%',
            },
            'remote.serverDownloadBaseUrl': {
              type: 'string',
              scope: 'application',
              pattern: '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://[^\\s/?#]+[^\\s]*)?$',
              patternErrorMessage:
                '%setting.ServerDownloadBaseUrl.patternError%',
              description: '%setting.ServerDownloadBaseUrl.description%',
            },
            'remote.serverDownloadFolder': {
              type: 'string',
              scope: 'application',
              description: '%setting.ServerDownloadFolder.description%',
            },
            'dev.containers.cacheVolume': {
              type: 'boolean',
              default: true,
              scope: 'application',
              description: '%setting.CacheVolume.description%',
            },
            'remote.containers.cacheVolume': {
              type: 'boolean',
              default: true,
              scope: 'application',
              description: '%setting.CacheVolume.description%',
              markdownDeprecationMessage: '%setting.CacheVolume.deprecated%',
            },
          },
        },
      },
      dependencies: {
        '@devcontainers/cli': '0.89.0',
        'jsonc-parser': '3.3.1',
        'lib-authority': 'workspace:*',
        'lib-forwarding': 'workspace:*',
        'lib-helper': 'workspace:*',
        'lib-host': 'workspace:*',
        'lib-identifiers': 'workspace:*',
        'lib-log': 'workspace:*',
        'lib-product': 'workspace:*',
        'lib-server': 'workspace:*',
        'lib-standdown': 'workspace:*',
      },
    });
  });

  it('F-0101.BR-3: the extension runs on the UI side', () => {
    deepStrictEqual(MANIFEST.extensionKind, ['ui']);
  });

  it('F-0101.BR-8: the seven proposals are declared, in order', () => {
    deepStrictEqual(MANIFEST.enabledApiProposals, [
      'resolvers',
      'tunnels',
      'workspaceTrust',
      'terminalDimensions',
      'contribEditSessions',
      'contribViewsRemote',
      'contribRemoteHelp',
    ]);
  });

  it('F-0419 3.2 and 6.1: both cache-volume settings are contributed, with their English texts', () => {
    const properties = (
      MANIFEST.contributes as {
        configuration: {properties: Record<string, Record<string, unknown>>};
      }
    ).configuration.properties;
    deepStrictEqual(
      [
        properties['dev.containers.cacheVolume'],
        properties['remote.containers.cacheVolume'],
        ENGLISH['setting.CacheVolume.description'],
        ENGLISH['setting.CacheVolume.deprecated'],
      ],
      [
        {
          type: 'boolean',
          default: true,
          scope: 'application',
          description: '%setting.CacheVolume.description%',
        },
        {
          type: 'boolean',
          default: true,
          scope: 'application',
          description: '%setting.CacheVolume.description%',
          markdownDeprecationMessage: '%setting.CacheVolume.deprecated%',
        },
        'Controls whether a Docker volume should be used to cache the VS Code server and extensions.',
        'Use `#dev.containers.cacheVolume#` instead.',
      ],
    );
  });

  it('containers-01: the only activation event is the resolve of the dev-container authority', () => {
    deepStrictEqual(MANIFEST.activationEvents, [
      'onResolveRemoteAuthority:dev-container',
    ]);
  });

  it('containers-01: the manifest has no browser entry or icon, and contributes the command, its two menus and the one setting', () => {
    deepStrictEqual(
      [
        'browser' in MANIFEST,
        'icon' in MANIFEST,
        Object.keys(MANIFEST.contributes as object),
      ],
      [false, false, ['commands', 'menus', 'configuration']],
    );
  });

  it('F-0401 3.1, F-1406: the reopen command has its id, category and title, and no command has a keybinding', () => {
    const contributes = MANIFEST.contributes as {
      commands: Array<{command: string}>;
      keybindings?: unknown;
    };
    deepStrictEqual(
      [
        contributes.commands.find(
          entry => entry.command === 'remote-containers.reopenInContainer',
        ),
        readJson('package.nls.json')['commands.Reopenincontainer.title'],
        contributes.keybindings,
      ],
      [
        {
          command: 'remote-containers.reopenInContainer',
          title: '%commands.Reopenincontainer.title%',
          category: 'Dev Containers',
        },
        'Reopen in Container',
        undefined,
      ],
    );
  });

  it('F-0405 3.1: the in-container rebuild commands have the titles of the reference, in the category Dev Containers', () => {
    const contributes = MANIFEST.contributes as {
      commands: Array<{command: string; title: string; category: string}>;
    };
    deepStrictEqual(
      [
        contributes.commands.filter(entry =>
          entry.command.startsWith('remote-containers.rebuild'),
        ),
        readJson('package.nls.json')['commands.Rebuildcontainer.title'],
        readJson('package.nls.json')[
          'commands.Rebuildcontainerwithoutcache.title'
        ],
      ],
      [
        [
          {
            command: 'remote-containers.rebuildContainer',
            title: '%commands.Rebuildcontainer.title%',
            category: 'Dev Containers',
          },
          {
            command: 'remote-containers.rebuildContainerNoCache',
            title: '%commands.Rebuildcontainerwithoutcache.title%',
            category: 'Dev Containers',
          },
        ],
        'Rebuild Container',
        'Rebuild Container Without Cache',
      ],
    );
  });

  /** The menu entries of the manifest that name one of `commands`. */
  function menusOf(commands: readonly string[]): Record<string, unknown[]> {
    const menus = (
      MANIFEST.contributes as {
        menus: Record<string, Array<{command: string}>>;
      }
    ).menus;
    return Object.fromEntries(
      Object.entries(menus).map(([name, entries]) => [
        name,
        entries.filter(entry => commands.includes(entry.command)),
      ]),
    );
  }

  it('F-0401 AC-5: the palette and the remote indicator list the command with the local clause of the reference', () => {
    deepStrictEqual(menusOf(['remote-containers.reopenInContainer']), {
      commandPalette: [
        {command: 'remote-containers.reopenInContainer', when: REOPEN_WHEN},
      ],
      'statusBar/remoteIndicator': [
        {
          command: 'remote-containers.reopenInContainer',
          group: 'remote_30_dev-container_2_actions@8',
          when: REOPEN_WHEN,
        },
      ],
    });
  });

  it('F-0405 3.1: both in-container rebuild commands are in the palette, and only the cached one is in the remote indicator', () => {
    deepStrictEqual(
      menusOf([
        'remote-containers.rebuildContainer',
        'remote-containers.rebuildContainerNoCache',
      ]),
      {
        commandPalette: [
          {command: 'remote-containers.rebuildContainer', when: REBUILD_WHEN},
          {
            command: 'remote-containers.rebuildContainerNoCache',
            when: REBUILD_WHEN,
          },
        ],
        'statusBar/remoteIndicator': [
          {
            command: 'remote-containers.rebuildContainer',
            group: 'remote_30_dev-container_2_actions@5',
            when: REBUILD_WHEN,
          },
        ],
      },
    );
  });

  it('F-1406.5: package.nls.json holds its keys, and every key package.json uses is one of them', () => {
    const used = [...JSON.stringify(MANIFEST).matchAll(/%([^%"]+)%/g)].map(
      match => match[1],
    );
    deepStrictEqual(
      [
        readJson('package.nls.json'),
        used.every(key => key !== undefined && key in ENGLISH),
      ],
      [ENGLISH, true],
    );
  });

  for (const locale of LOCALES) {
    it(`F-1406.5: package.nls.${locale}.json holds the keys of the English file with its values`, () => {
      deepStrictEqual(readJson(`package.nls.${locale}.json`), ENGLISH);
    });
  }

  it('F-1406.5: identifiers.json names the identity of the family and nothing invented', () => {
    deepStrictEqual(readJson('identifiers.json'), {
      source: 'remote-oss/remote-containers#107 (F-1406)',
      standsDownFor: 'ms-vscode-remote.remote-containers',
      standingDownKey: 'remote-containers:standingDown',
      namespaces: {
        commands: ['remote-containers.'],
        settings: ['dev.containers.', 'remote.serverDownload'],
        contextKeys: ['remote-containers:'],
        internalCommands: ['remote-oss.'],
      },
      contextKeys: [
        {id: 'remote-containers:standingDown', setter: 'extension'},
        {id: 'hideConnectCommands', setter: 'extension'},
        {id: 'hideRebuildCommands', setter: 'extension'},
      ],
      infoLineCommands: [],
      runtimeCommands: [
        {
          id: 'remote-containers.revealLogTerminal',
          purpose:
            'the "(show log)" link of the connect progress, which reveals the Dev Containers log',
        },
      ],
      internal: [{id: 'remote-oss.gate.claim', role: 'called', kind: 'query'}],
      invented: [
        {
          id: 'remote-containers:standingDown',
          kind: 'contextKeys',
          spec: 'F-1406',
          date: '2026-10-14',
        },
      ],
      settingPairs: [
        {
          current: 'dev.containers.cacheVolume',
          legacy: 'remote.containers.cacheVolume',
          winner: 'current',
        },
      ],
      ungated: [],
      locales: LOCALES,
    });
  });

  it('F-1406.5: every locale has an l10n bundle with the strings of the English one', () => {
    const english = readJson('l10n/bundle.l10n.json');
    deepStrictEqual(
      LOCALES.map(
        locale =>
          existsSync(
            path.join(PACKAGE, 'l10n', `bundle.l10n.${locale}.json`),
          ) &&
          JSON.stringify(readJson(`l10n/bundle.l10n.${locale}.json`)) ===
            JSON.stringify(english),
      ),
      LOCALES.map(() => true),
    );
  });
});
