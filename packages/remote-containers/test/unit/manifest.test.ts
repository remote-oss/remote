/**
 * @fileoverview The manifest of the package: its identity, activation, proposals, capabilities, string tables and
 * identifiers. Every expected value is written here as a literal.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {views} from '../../src/identifiers.generated.ts';

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

/** The four rebuild commands as the manifest contributes them, after Reopen in Container. */
const REBUILD_COMMANDS = [
  {
    command: 'remote-containers.rebuildContainer',
    title: '%commands.Rebuildcontainer.title%',
    category: 'Dev Containers',
    icon: {
      light: 'resources/light/tools.svg',
      dark: 'resources/dark/tools.svg',
    },
  },
  {
    command: 'remote-containers.rebuildContainerNoCache',
    title: '%commands.Rebuildcontainerwithoutcache.title%',
    category: 'Dev Containers',
  },
  {
    command: 'remote-containers.rebuildAndReopenInContainer',
    title: '%commands.Rebuildandreopenincontainer.title%',
    category: 'Dev Containers',
  },
  {
    command: 'remote-containers.rebuildNoCacheAndReopenInContainer',
    title: '%commands.Rebuildwithoutcacheandreopenincontainer.title%',
    category: 'Dev Containers',
  },
];

/** The `when` clause of the in-container rebuild commands. */
const REBUILD_WHEN =
  '!hideRebuildCommands && remoteName =~ /^dev-container$/ && !remote-containers:standingDown';

/** The `when` clause of the rebuild commands of a local window. */
const REBUILD_REOPEN_WHEN =
  '!hideRebuildCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && !remote-containers:standingDown';

/** The `when` clause of the command's palette entry and menu entry. */
const REOPEN_WHEN =
  '!hideConnectCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && !remote-containers:standingDown';

const STANDING_DOWN = '!remote-containers:standingDown';

/** The welcome texts of the view as 0.4 contributes them: the markup of a link to an unregistered command is gone. */
const WELCOME_TEXTS = {
  'viewsWelcome.targetsContainers.needsDockerStartOrInstall':
    'Get started with containers by installing Docker or by visiting the help view. [Refresh](command:remote-containers.explorerTargetsRefresh) after installation and startup.',
  'viewsWelcome.targetsContainers.noContainersWithFolder':
    "Get started with containers by running one of the Dev Containers commands. You can [reopen the current folder in a container](command:remote-containers.reopenInContainer), or open another folder in a container. Open Folder in Container If you're new to containers and want to try a sample, there are several to choose from.",
  'viewsWelcome.targetsContainers.noContainersWithoutFolder':
    "Get started with containers by running one of the Dev Containers commands. You can open an existing folder in a container. Open Folder in Container If you're new to containers and want to try a sample, there are several to choose from.",
};

const TARGETS_TITLE_WHEN =
  'view == targetsContainers && !remote-containers:needsDockerStartOrInstall && !remote-containers:noContainersWithFolder && !remote-containers:noContainersWithoutFolder && !remote-containers:standingDown';

const DETAILS_TITLE_WHEN =
  'view == detailsContainers && !remote-containers:standingDown';

const DETAILS_REBUILD_WHEN =
  '!hideRebuildCommands && view == detailsContainers && remoteName == dev-container && !remote-containers:standingDown';

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
  'commands.explorerTargetsRefresh.title': 'Refresh',
  'views.targetsContainers.name': 'Dev Containers',
  'commands.explorerDetailsRefresh.title': 'Refresh',
  'views.detailsContainers.name': 'Details (Containers)',
  ...WELCOME_TEXTS,
  'commands.Rebuildandreopenincontainer.title':
    'Rebuild and Reopen in Container',
  'commands.Rebuildwithoutcacheandreopenincontainer.title':
    'Rebuild Without Cache and Reopen in Container',
  'setting.Dockerpath.description':
    'Docker (or Podman or WSLc) executable name or path.',
  'setting.ServerDownloadBaseUrl.description':
    'Base URL for downloading the VS Code server. The path `/commit:{commit}/server-{platform}/{quality}` will be appended to this URL. Platforms include `linux-x64`, `linux-armhf`, `linux-arm64`, `linux-alpine`, and `alpine-arm64`. Quality is `stable` or `insider`.',
  'setting.ServerDownloadBaseUrl.patternError':
    'Must be a URL (e.g., https://example.com or https://example.com:8080/path).',
  'setting.Defaultextensions.description':
    'Configures the list of extensions to always install while creating a container.',
  'setting.Defaultextensions.itemError':
    "Expected format '${publisher}.${name}'. Example: 'vscode.csharp'.",
  'setting.Remotecontainersdefaultextensions.deprecation':
    "Use 'dev.containers.defaultExtensions' instead.",
  'setting.Remotecontainersdefaultextensions.markdownDeprecation':
    'Use `#dev.containers.defaultExtensions#` instead.',
  'setting.ServerDownloadFolder.description':
    "Local folder for downloading and caching VS Code server archives. The archives will be stored as `{downloadFolder}/{commit}/vscode-server-{platform}[-{quality}].tar.gz`. Platforms include `linux-x64`, `linux-armhf`, `linux-arm64`, `linux-alpine`, and `alpine-arm64`. Quality is `stable` or `insider`. The `-{quality}` suffix is omitted for `stable`. The default is in the system's temp folder.",
  'setting.CacheVolume.description':
    'Controls whether a Docker volume should be used to cache the VS Code server and extensions.',
  'setting.CacheVolume.deprecationMessage':
    "Use 'dev.containers.cacheVolume' instead.",
  'setting.CacheVolume.markdownDeprecationMessage':
    'Use `#dev.containers.cacheVolume#` instead.',
  'setting.WorkspaceMountConsistency.description':
    'The consistency level used for the workspace mount (existing containers must be rebuilt to take effect).',
  'setting.WorkspaceMountConsistency.consistent': 'Perfect consistency.',
  'setting.WorkspaceMountConsistency.cached':
    'The host\u2019s view is authoritative.',
  'setting.WorkspaceMountConsistency.delegated':
    'The container\u2019s view is authoritative.',
  'setting.WorkspaceMountConsistency.deprecationMessage':
    "Use 'dev.containers.workspaceMountConsistency' instead.",
  'setting.WorkspaceMountConsistency.markdownDeprecationMessage':
    'Use `#dev.containers.workspaceMountConsistency#` instead.',
  'setting.MountGitWorktreeCommonDir.description':
    'Mount the Git worktree common dir for Git operations to work in the container. This requires the worktree to be created with relative paths (`git worktree add --relative-paths`).',
};

const MOUNT_SETTINGS = {
  'dev.containers.workspaceMountConsistency': {
    type: 'string',
    default: 'cached',
    scope: 'application',
    enum: ['consistent', 'cached', 'delegated'],
    enumDescriptions: [
      '%setting.WorkspaceMountConsistency.consistent%',
      '%setting.WorkspaceMountConsistency.cached%',
      '%setting.WorkspaceMountConsistency.delegated%',
    ],
    description: '%setting.WorkspaceMountConsistency.description%',
  },
  'remote.containers.workspaceMountConsistency': {
    scope: 'application',
    deprecationMessage:
      '%setting.WorkspaceMountConsistency.deprecationMessage%',
    markdownDeprecationMessage:
      '%setting.WorkspaceMountConsistency.markdownDeprecationMessage%',
  },
  'dev.containers.experimentalMountGitWorktreeCommonDir': {
    type: 'boolean',
    default: false,
    scope: 'application',
    description: '%setting.MountGitWorktreeCommonDir.description%',
  },
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
      activationEvents: [
        'onResolveRemoteAuthority:dev-container',
        'onStartupFinished',
      ],
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
          ...REBUILD_COMMANDS,
          {
            command: 'remote-containers.explorerTargetsRefresh',
            title: '%commands.explorerTargetsRefresh.title%',
            category: 'Dev Containers',
            icon: {
              light: 'resources/light/refresh.svg',
              dark: 'resources/dark/refresh.svg',
            },
          },
          {
            command: 'remote-containers.explorerDetailsRefresh',
            title: '%commands.explorerDetailsRefresh.title%',
            category: 'Dev Containers',
            icon: {
              light: 'resources/light/refresh.svg',
              dark: 'resources/dark/refresh.svg',
            },
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
            {
              command: 'remote-containers.rebuildAndReopenInContainer',
              when: REBUILD_REOPEN_WHEN,
            },
            {
              command: 'remote-containers.rebuildNoCacheAndReopenInContainer',
              when: REBUILD_REOPEN_WHEN,
            },
            {
              command: 'remote-containers.explorerTargetsRefresh',
              when: 'false',
            },
            {
              command: 'remote-containers.explorerDetailsRefresh',
              when: 'false',
            },
          ],
          'view/title': [
            {
              command: 'remote-containers.explorerTargetsRefresh',
              group: 'navigation@3',
              when: TARGETS_TITLE_WHEN,
            },
            {
              command: 'remote-containers.rebuildContainer',
              group: 'navigation@6',
              when: DETAILS_REBUILD_WHEN,
            },
            {
              command: 'remote-containers.explorerDetailsRefresh',
              group: 'navigation@4',
              when: DETAILS_TITLE_WHEN,
            },
          ],
          'view/item/context': [
            {
              command: 'workbench.action.closeFolder',
              group: '1_folder@1',
              when: 'view == targetsContainers && viewItem =~ /(^| )activeFolder( |$)/ && !remote-containers:standingDown',
            },
            {
              command: 'remote-containers.rebuildContainer',
              group: '2_container@1',
              when: 'view == targetsContainers && viewItem =~ /(^| )own( |$)/ && viewItem =~ /(^| )dev( |$)/ && !hideRebuildCommands && !remote-containers:standingDown',
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
        views: {
          remote: [
            {
              id: 'targetsContainers',
              name: '%views.targetsContainers.name%',
              group: 'targets@2',
              when: '!hideConnectCommands',
              remoteName: [
                'dev-container',
                'attached-container',
                'exec',
                'k8s-container',
                'apple-container',
              ],
            },
            {
              id: 'detailsContainers',
              name: '%views.detailsContainers.name%',
              group: 'details@1',
              when: '!hideConnectCommands && remote-containers:showDetails',
              remoteName: ['dev-container', 'attached-container'],
            },
          ],
        },
        viewsWelcome: [
          {
            view: 'targetsContainers',
            contents:
              '%viewsWelcome.targetsContainers.needsDockerStartOrInstall%',
            when: 'remote-containers:needsDockerStartOrInstall && !remote-containers:standingDown',
          },
          {
            view: 'targetsContainers',
            contents: '%viewsWelcome.targetsContainers.noContainersWithFolder%',
            when: 'remote-containers:noContainersWithFolder && !remote-containers:standingDown',
          },
          {
            view: 'targetsContainers',
            contents:
              '%viewsWelcome.targetsContainers.noContainersWithoutFolder%',
            when: 'remote-containers:noContainersWithoutFolder && !remote-containers:standingDown',
          },
        ],
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
              scope: 'application',
              deprecationMessage: '%setting.CacheVolume.deprecationMessage%',
              markdownDeprecationMessage:
                '%setting.CacheVolume.markdownDeprecationMessage%',
            },
            'dev.containers.defaultExtensions': {
              type: 'array',
              default: [],
              scope: 'application',
              items: {
                type: 'string',
                pattern:
                  '([a-z0-9A-Z][a-z0-9-A-Z]*)\\.([a-z0-9A-Z][a-z0-9-A-Z]*)',
                errorMessage: '%setting.Defaultextensions.itemError%',
              },
              description: '%setting.Defaultextensions.description%',
            },
            'remote.containers.defaultExtensions': {
              scope: 'application',
              deprecationMessage:
                '%setting.Remotecontainersdefaultextensions.deprecation%',
              markdownDeprecationMessage:
                '%setting.Remotecontainersdefaultextensions.markdownDeprecation%',
            },
            ...MOUNT_SETTINGS,
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
        ENGLISH['setting.CacheVolume.deprecationMessage'],
        ENGLISH['setting.CacheVolume.markdownDeprecationMessage'],
      ],
      [
        {
          type: 'boolean',
          default: true,
          scope: 'application',
          description: '%setting.CacheVolume.description%',
        },
        {
          scope: 'application',
          deprecationMessage: '%setting.CacheVolume.deprecationMessage%',
          markdownDeprecationMessage:
            '%setting.CacheVolume.markdownDeprecationMessage%',
        },
        'Controls whether a Docker volume should be used to cache the VS Code server and extensions.',
        "Use 'dev.containers.cacheVolume' instead.",
        'Use `#dev.containers.cacheVolume#` instead.',
      ],
    );
  });
  it('F-0411 3.2, F-0102 3.2: the two mount settings and the deprecated consistency key are contributed with their shapes, and nothing else', () => {
    const properties = (
      MANIFEST.contributes as {
        configuration: {properties: Record<string, unknown>};
      }
    ).configuration.properties;
    deepStrictEqual(
      Object.keys(MOUNT_SETTINGS).map(key => properties[key]),
      Object.values(MOUNT_SETTINGS),
    );
  });

  it('containers-11 (athena on #892): the activation events are the resolve of the dev-container authority and the end of the startup', () => {
    deepStrictEqual(MANIFEST.activationEvents, [
      'onResolveRemoteAuthority:dev-container',
      'onStartupFinished',
    ]);
  });

  it('containers-01, containers-30: the manifest has no browser entry or icon, and contributes the commands, their menus, the view with its welcome texts and the settings', () => {
    deepStrictEqual(
      [
        'browser' in MANIFEST,
        'icon' in MANIFEST,
        Object.keys(MANIFEST.contributes as object),
      ],
      [
        false,
        false,
        ['commands', 'menus', 'views', 'viewsWelcome', 'configuration'],
      ],
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

  it('F-0405 3.1: the four rebuild commands have the titles of the reference, in the category Dev Containers', () => {
    const contributes = MANIFEST.contributes as {
      commands: Array<{command: string; title: string; category: string}>;
    };
    deepStrictEqual(
      [
        contributes.commands.filter(entry =>
          entry.command.startsWith('remote-containers.rebuild'),
        ),
        [
          'commands.Rebuildcontainer.title',
          'commands.Rebuildcontainerwithoutcache.title',
          'commands.Rebuildandreopenincontainer.title',
          'commands.Rebuildwithoutcacheandreopenincontainer.title',
        ].map(key => readJson('package.nls.json')[key]),
      ],
      [
        [...REBUILD_COMMANDS],
        [
          'Rebuild Container',
          'Rebuild Container Without Cache',
          'Rebuild and Reopen in Container',
          'Rebuild Without Cache and Reopen in Container',
        ],
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

  it('F-0401 AC-5: the palette and the remote indicator list the command with the local clause of the reference, which has no workspace-trust term, so Restricted Mode lists it (PRE-7, AC-21)', () => {
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
      'view/title': [],
      'view/item/context': [],
    });
  });

  it("F-0405 3.1, F-0901 3.3 #21: both in-container rebuild commands are in the palette, only the cached one is in the remote indicator and in the view's item menu", () => {
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
        'view/title': [
          {
            command: 'remote-containers.rebuildContainer',
            group: 'navigation@6',
            when: DETAILS_REBUILD_WHEN,
          },
        ],
        'view/item/context': [
          {
            command: 'remote-containers.rebuildContainer',
            group: '2_container@1',
            when: 'view == targetsContainers && viewItem =~ /(^| )own( |$)/ && viewItem =~ /(^| )dev( |$)/ && !hideRebuildCommands && !remote-containers:standingDown',
          },
        ],
      },
    );
  });

  it('F-0405 3.1: the and-reopen rebuild commands are in the palette for a local window with a folder, and in no other menu', () => {
    deepStrictEqual(
      menusOf([
        'remote-containers.rebuildAndReopenInContainer',
        'remote-containers.rebuildNoCacheAndReopenInContainer',
      ]),
      {
        commandPalette: [
          {
            command: 'remote-containers.rebuildAndReopenInContainer',
            when: REBUILD_REOPEN_WHEN,
          },
          {
            command: 'remote-containers.rebuildNoCacheAndReopenInContainer',
            when: REBUILD_REOPEN_WHEN,
          },
        ],
        'statusBar/remoteIndicator': [],
        'view/title': [],
        'view/item/context': [],
      },
    );
  });

  /** The parts of `contributes` the Dev Containers view is made of. */
  const VIEW_PARTS = MANIFEST.contributes as {
    commands: Array<{command: string}>;
    views: Record<string, Array<Record<string, unknown>>>;
    viewsWelcome: Array<{view: string; contents: string; when: string}>;
    menus: Record<string, Array<{command: string; when: string}>>;
  };

  it('F-0906 3.3, containers-30: the view is the one the proposal probe asks for, in the remote container with the reference group, clause and remote names, and no stand-down clause', () => {
    deepStrictEqual(
      [
        views.targetsContainers,
        Object.keys(VIEW_PARTS.views),
        VIEW_PARTS.views.remote?.slice(0, 1),
      ],
      [
        'targetsContainers',
        ['remote'],
        [
          {
            id: 'targetsContainers',
            name: '%views.targetsContainers.name%',
            group: 'targets@2',
            when: '!hideConnectCommands',
            remoteName: [
              'dev-container',
              'attached-container',
              'exec',
              'k8s-container',
              'apple-container',
            ],
          },
        ],
      ],
    );
  });

  it('#960 link rule: every link of a welcome text names a command the package registers, and the words of the links to others stay as plain words', () => {
    const registered = VIEW_PARTS.commands.map(entry => entry.command);
    const linked = VIEW_PARTS.viewsWelcome.flatMap(welcome =>
      [
        ...String(
          readJson('package.nls.json')[welcome.contents.replaceAll('%', '')],
        ).matchAll(/\]\(command:([^)]+)\)/g),
      ].map(match => String(match[1])),
    );
    deepStrictEqual(
      [
        linked.filter(command => !registered.includes(command)),
        linked.sort(),
        VIEW_PARTS.viewsWelcome.map(welcome => welcome.view),
      ],
      [
        [],
        [
          'remote-containers.explorerTargetsRefresh',
          'remote-containers.reopenInContainer',
        ],
        ['targetsContainers', 'targetsContainers', 'targetsContainers'],
      ],
    );
  });

  it('#960 §3: every welcome and every menu entry of the view stands down with the package, and the view itself does not', () => {
    const clauses = [
      ...VIEW_PARTS.viewsWelcome.map(welcome => welcome.when),
      ...(VIEW_PARTS.menus['view/title'] ?? []).map(entry => entry.when),
      ...(VIEW_PARTS.menus['view/item/context'] ?? []).map(entry => entry.when),
    ];
    deepStrictEqual(
      [
        clauses.length,
        clauses.every(clause => clause.endsWith(` && ${STANDING_DOWN}`)),
        JSON.stringify(VIEW_PARTS.views).includes('standingDown'),
      ],
      [8, true, false],
    );
  });

  it('F-0901 3.1, BR-6, BR-7: Refresh is out of the palette, and the view title shows it only with Docker reachable and at least one container', () => {
    deepStrictEqual(
      [
        VIEW_PARTS.menus.commandPalette?.find(
          entry => entry.command === 'remote-containers.explorerTargetsRefresh',
        ),
        VIEW_PARTS.menus['view/title']?.slice(0, 1),
      ],
      [
        {command: 'remote-containers.explorerTargetsRefresh', when: 'false'},
        [
          {
            command: 'remote-containers.explorerTargetsRefresh',
            group: 'navigation@3',
            when: TARGETS_TITLE_WHEN,
          },
        ],
      ],
    );
  });

  it('F-0903 3.3: the Details view is in the remote container with the reference group, clause and remote names and no stand-down clause, its Refresh is out of the palette, and the toolbar has Rebuild then Refresh with the stand-down clause', () => {
    deepStrictEqual(
      [
        views.detailsContainers,
        VIEW_PARTS.views.remote?.[1],
        VIEW_PARTS.menus.commandPalette?.find(
          entry => entry.command === 'remote-containers.explorerDetailsRefresh',
        ),
        VIEW_PARTS.menus['view/title']?.slice(1),
        ENGLISH['views.detailsContainers.name'],
      ],
      [
        'detailsContainers',
        {
          id: 'detailsContainers',
          name: '%views.detailsContainers.name%',
          group: 'details@1',
          when: '!hideConnectCommands && remote-containers:showDetails',
          remoteName: ['dev-container', 'attached-container'],
        },
        {command: 'remote-containers.explorerDetailsRefresh', when: 'false'},
        [
          {
            command: 'remote-containers.rebuildContainer',
            group: 'navigation@6',
            when: DETAILS_REBUILD_WHEN,
          },
          {
            command: 'remote-containers.explorerDetailsRefresh',
            group: 'navigation@4',
            when: DETAILS_TITLE_WHEN,
          },
        ],
        'Details (Containers)',
      ],
    );
  });

  it('F-0901 3.3 #10, #21: Close Workspace is on the active folder row, and Rebuild Container on the window own dev container row, in the groups of the reference', () => {
    deepStrictEqual(VIEW_PARTS.menus['view/item/context'], [
      {
        command: 'workbench.action.closeFolder',
        group: '1_folder@1',
        when: 'view == targetsContainers && viewItem =~ /(^| )activeFolder( |$)/ && !remote-containers:standingDown',
      },
      {
        command: 'remote-containers.rebuildContainer',
        group: '2_container@1',
        when: 'view == targetsContainers && viewItem =~ /(^| )own( |$)/ && viewItem =~ /(^| )dev( |$)/ && !hideRebuildCommands && !remote-containers:standingDown',
      },
    ]);
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
        settings: [
          'dev.containers.',
          'remote.containers.',
          'remote.serverDownload',
        ],
        contextKeys: ['remote-containers:'],
        internalCommands: ['remote-oss.'],
      },
      contextKeys: [
        {id: 'remote-containers:standingDown', setter: 'extension'},
        {id: 'hideConnectCommands', setter: 'extension'},
        {id: 'hideRebuildCommands', setter: 'extension'},
        {
          id: 'remote-containers:needsDockerStartOrInstall',
          setter: 'extension',
        },
        {id: 'remote-containers:noContainersWithFolder', setter: 'extension'},
        {
          id: 'remote-containers:noContainersWithoutFolder',
          setter: 'extension',
        },
        {id: 'remote-containers:showDetails', setter: 'extension'},
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
        {
          current: 'dev.containers.defaultExtensions',
          legacy: 'remote.containers.defaultExtensions',
          winner: 'current',
        },
        {
          current: 'dev.containers.workspaceMountConsistency',
          legacy: 'remote.containers.workspaceMountConsistency',
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
