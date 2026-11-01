/**
 * @fileoverview The manifest of the package: its identity, activation, proposals, capabilities, string tables and
 * identifiers. Every expected value is written here as a literal.
 */

import {deepStrictEqual, partialDeepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {views} from '../../src/identifiers.generated.ts';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

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

/** The `when` clause of Open Folder in Container in the palette: a local window or a dev container window. */
const OPEN_FOLDER_WHEN =
  '!hideConnectCommands && remoteName =~ /^(dev-container)?$/ && !remote-containers:standingDown';

/** The `when` clause of its remote indicator item: only a local window with no folder. */
const OPEN_FOLDER_INDICATOR_WHEN =
  '!hideConnectCommands && workspaceFolderCount == 0 && !remoteName && !virtualWorkspace && !remote-containers:standingDown';

/** The `when` clause of the rebuild commands of a local window. */
const REBUILD_REOPEN_WHEN =
  '!hideRebuildCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && !remote-containers:standingDown';

/** The `when` clause of the command's palette entry and menu entry. */
const REOPEN_WHEN =
  '!hideConnectCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && !remote-containers:standingDown';

const STANDING_DOWN = '!remote-containers:standingDown';

/** The welcome texts of the view as 0.4 contributes them: the links to commands the package registers stay, and the other links are gone. */
const WELCOME_TEXTS = {
  'viewsWelcome.targetsContainers.needsDockerStartOrInstall':
    'Get started with containers by installing Docker or by visiting the help view. [Refresh](command:remote-containers.explorerTargetsRefresh) after installation and startup.',
  'viewsWelcome.targetsContainers.noContainersWithFolder':
    "Get started with containers by running one of the Dev Containers commands. You can [reopen the current folder in a container](command:remote-containers.reopenInContainer), or open another folder in a container.\n[Open Folder in Container](command:remote-containers.openFolder)\nIf you're new to containers and want to try a sample, there are several to choose from.",
  'viewsWelcome.targetsContainers.noContainersWithoutFolder':
    "Get started with containers by running one of the Dev Containers commands. You can open an existing folder in a container.\n[Open Folder in Container](command:remote-containers.openFolder)\nIf you're new to containers and want to try a sample, there are several to choose from.",
};

/** The `when` of a row action: the view's rows that carry `token`, with `extra` between it and the stand-down clause. */
function rowWhen(token: string, extra = ''): string {
  return `view == targetsContainers && viewItem =~ /(^| )${token}( |$)/${extra} && !remote-containers:standingDown`;
}

/** The entries slice B adds to the row menu, in the manifest's order; every entry carries the clauses of its token and none is staged any more. */
const ROW_ACTION_ENTRIES = [
  ['openFolderInContainerInCurrentWindow', '1_folder@1', 'openFolder', false],
  ['openFolderInContainerInNewWindow', '1_folder@2', 'openFolder', false],
  ['startContainer', '1_container@3', 'start', false],
  ['showDetails', '1_container@4', 'details', false],
  ['inspectDockerResource', '1_container@5', 'inspect', false],
  ['showContainerLog', '1_container@6', 'log', false],
  ['stopContainer', '2_container@2', 'stop', false],
  ['removeContainer', '2_container@3', 'remove', false],
  ['openFolderInContainerInCurrentWindow', 'inline@1', 'openFolder', false],
  ['openFolderInContainerInNewWindow', 'inline@2', 'openFolder', false],
  ['removeContainer', 'inline@3', 'remove', false],
].map(([command, group, token, later]) => ({
  command: `remote-containers.${String(command)}`,
  group: String(group),
  when: rowWhen(String(token), later === true ? ' && false' : ''),
}));

/** The Inspect entry of the Details view's Image row. */
const DETAILS_IMAGE_INSPECT = {
  command: 'remote-containers.inspectDockerResource',
  group: '1_container@5',
  when: 'view == detailsContainers && viewItem == image && !remote-containers:standingDown',
};

const TARGETS_TITLE_WHEN =
  'view == targetsContainers && !remote-containers:needsDockerStartOrInstall && !remote-containers:noContainersWithFolder && !remote-containers:noContainersWithoutFolder && !remote-containers:standingDown';

const DETAILS_TITLE_WHEN =
  'view == detailsContainers && !remote-containers:standingDown';

const DETAILS_REBUILD_WHEN =
  '!hideRebuildCommands && view == detailsContainers && remoteName == dev-container && !remote-containers:standingDown';

const CREATE_FILE_WHEN =
  '!remoteName && !virtualWorkspace && !remote-containers:standingDown';

const CREATE_FILE_INDICATOR_WHEN =
  'workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && !remote-containers:standingDown';

const ENGLISH = {
  description:
    'Develop inside a container that carries its own toolchain, so each project brings its environment with it.',
  'capabilities.untrustedWorkspaces.description':
    'Opening a folder in a container requires workspace trust.',
  'configuration.title': 'Dev Containers',
  'commands.Reopenincontainer.title': 'Reopen in Container',
  'commands.Openfolder.title': 'Open Folder in Container...',
  'commands.Createdevcontainerfile.title':
    'Add Dev Container Configuration Files...',
  'commands.Rebuildcontainer.title': 'Rebuild Container',
  'commands.Rebuildcontainerwithoutcache.title':
    'Rebuild Container Without Cache',
  'commands.Showreopenincontainernotificationreset.title':
    "Reset Don't Show Reopen Notification",
  'commands.explorerTargetsRefresh.title': 'Refresh',
  'commands.startContainer.title': 'Start Container',
  'commands.stopContainer.title': 'Stop Container',
  'commands.removeContainer.title': 'Remove Container',
  'commands.openFolderInContainerInCurrentWindow.title':
    'Open in Container in Current Window',
  'commands.openFolderInContainerInNewWindow.title':
    'Open in Container in New Window',
  'commands.showDetails.title': 'Show Details',
  'commands.inspectDockerResource.title': 'Inspect',
  'commands.showContainerLog.title': 'Show Container Log',
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
  'setting.DefaultFeatures.description':
    'Configures the list of features to always install while creating a container.',
  'setting.Lockfile.description':
    'Controls whether a devcontainer-lock.json should be written.',
};

const FEATURE_SETTINGS = {
  'dev.containers.defaultFeatures': {
    type: 'object',
    default: {},
    scope: 'application',
    description: '%setting.DefaultFeatures.description%',
  },
  'dev.containers.lockfile': {
    type: 'boolean',
    default: true,
    scope: 'application',
    description: '%setting.Lockfile.description%',
  },
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
  it('F-0101 AC-4: the identity is ours, field by field, and the contributions the card lists are contributed with their values', () => {
    partialDeepStrictEqual(MANIFEST, {
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
      engines: {vscode: '^1.125.0'},
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
          {
            command: 'remote-containers.openFolder',
            title: '%commands.Openfolder.title%',
            category: 'Dev Containers',
          },
          {
            command: 'remote-containers.createDevContainerFile',
            title: '%commands.Createdevcontainerfile.title%',
            category: 'Dev Containers',
          },
          ...REBUILD_COMMANDS,
          {
            command: 'remote-containers.showReopenInContainerNotificationReset',
            title: '%commands.Showreopenincontainernotificationreset.title%',
            category: 'Dev Containers',
          },
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
            command: 'remote-containers.startContainer',
            title: '%commands.startContainer.title%',
            category: 'Dev Containers',
            icon: {
              light: 'resources/light/vm-start.svg',
              dark: 'resources/dark/vm-start.svg',
            },
          },
          {
            command: 'remote-containers.stopContainer',
            title: '%commands.stopContainer.title%',
            category: 'Dev Containers',
          },
          {
            command: 'remote-containers.removeContainer',
            title: '%commands.removeContainer.title%',
            category: 'Dev Containers',
            icon: {
              light: 'resources/light/remove.svg',
              dark: 'resources/dark/remove.svg',
            },
          },
          {
            command: 'remote-containers.openFolderInContainerInCurrentWindow',
            title: '%commands.openFolderInContainerInCurrentWindow.title%',
            category: 'Dev Containers',
            icon: '$(arrow-right)',
          },
          {
            command: 'remote-containers.openFolderInContainerInNewWindow',
            title: '%commands.openFolderInContainerInNewWindow.title%',
            category: 'Dev Containers',
            icon: '$(empty-window)',
          },
          {
            command: 'remote-containers.showDetails',
            title: '%commands.showDetails.title%',
            category: 'Dev Containers',
          },
          {
            command: 'remote-containers.inspectDockerResource',
            title: '%commands.inspectDockerResource.title%',
            category: 'Dev Containers',
          },
          {
            command: 'remote-containers.showContainerLog',
            title: '%commands.showContainerLog.title%',
            category: 'Dev Containers',
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
              command: 'remote-containers.openFolder',
              when: OPEN_FOLDER_WHEN,
            },
            {
              command: 'remote-containers.createDevContainerFile',
              when: CREATE_FILE_WHEN,
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
            {command: 'remote-containers.startContainer', when: 'false'},
            {command: 'remote-containers.stopContainer', when: 'false'},
            {command: 'remote-containers.removeContainer', when: 'false'},
            {
              command: 'remote-containers.openFolderInContainerInCurrentWindow',
              when: 'false',
            },
            {
              command: 'remote-containers.openFolderInContainerInNewWindow',
              when: 'false',
            },
            {command: 'remote-containers.showDetails', when: 'false'},
            {command: 'remote-containers.inspectDockerResource', when: 'false'},
            {command: 'remote-containers.showContainerLog', when: 'false'},
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
            ...ROW_ACTION_ENTRIES,
            DETAILS_IMAGE_INSPECT,
          ],
          'statusBar/remoteIndicator': [
            {
              command: 'remote-containers.reopenInContainer',
              group: 'remote_30_dev-container_2_actions@8',
              when: REOPEN_WHEN,
            },
            {
              command: 'remote-containers.openFolder',
              group: 'remote_30_dev-container_2_actions@8',
              when: OPEN_FOLDER_INDICATOR_WHEN,
            },
            {
              command: 'remote-containers.createDevContainerFile',
              group: 'remote_30_dev-container_2_actions@4',
              when: CREATE_FILE_INDICATOR_WHEN,
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
            ...FEATURE_SETTINGS,
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

  it('F-0414 3.2: the two Feature settings are contributed with their shapes, and their English texts are the reference’s', () => {
    const properties = (
      MANIFEST.contributes as {
        configuration: {properties: Record<string, unknown>};
      }
    ).configuration.properties;
    deepStrictEqual(
      [
        Object.keys(FEATURE_SETTINGS).map(key => properties[key]),
        ENGLISH['setting.DefaultFeatures.description'],
        ENGLISH['setting.Lockfile.description'],
      ],
      [
        Object.values(FEATURE_SETTINGS),
        'Configures the list of features to always install while creating a container.',
        'Controls whether a devcontainer-lock.json should be written.',
      ],
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

  it('F-0402 3.1: the reset command is contributed under Dev Containers, with no entry in the palette that hides it', () => {
    const contributes = MANIFEST.contributes as {
      commands: Array<{command: string}>;
      menus: {commandPalette: Array<{command: string}>};
    };
    deepStrictEqual(
      [
        contributes.commands.find(
          entry =>
            entry.command ===
            'remote-containers.showReopenInContainerNotificationReset',
        ),
        contributes.menus.commandPalette.some(
          entry =>
            entry.command ===
            'remote-containers.showReopenInContainerNotificationReset',
        ),
      ],
      [
        {
          command: 'remote-containers.showReopenInContainerNotificationReset',
          title: '%commands.Showreopenincontainernotificationreset.title%',
          category: 'Dev Containers',
        },
        false,
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

  it('F-0403 3.1: Open Folder in Container has its title, the palette clause of release 1’s windows, and the indicator item only in an empty local window', () => {
    deepStrictEqual(
      [
        menusOf(['remote-containers.openFolder']),
        readJson('package.nls.json')['commands.Openfolder.title'],
      ],
      [
        {
          commandPalette: [
            {
              command: 'remote-containers.openFolder',
              when: OPEN_FOLDER_WHEN,
            },
          ],
          'statusBar/remoteIndicator': [
            {
              command: 'remote-containers.openFolder',
              group: 'remote_30_dev-container_2_actions@8',
              when: OPEN_FOLDER_INDICATOR_WHEN,
            },
          ],
          'view/title': [],
          'view/item/context': [],
        },
        'Open Folder in Container...',
      ],
    );
  });

  it('F-0801 AC-1: Add Dev Container Configuration Files has its title, the palette clause of a local window and the indicator item only in a window with a folder', () => {
    deepStrictEqual(
      [
        menusOf(['remote-containers.createDevContainerFile']),
        readJson('package.nls.json')['commands.Createdevcontainerfile.title'],
      ],
      [
        {
          commandPalette: [
            {
              command: 'remote-containers.createDevContainerFile',
              when: CREATE_FILE_WHEN,
            },
          ],
          'statusBar/remoteIndicator': [
            {
              command: 'remote-containers.createDevContainerFile',
              group: 'remote_30_dev-container_2_actions@4',
              when: CREATE_FILE_INDICATOR_WHEN,
            },
          ],
          'view/title': [],
          'view/item/context': [],
        },
        'Add Dev Container Configuration Files...',
      ],
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
          'remote-containers.openFolder',
          'remote-containers.openFolder',
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
      [20, true, false],
    );
  });

  it('F-0901 AC-15: F-0901 3.1, BR-6, BR-7: Refresh is out of the palette, and the view title shows it only with Docker reachable and at least one container', () => {
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
    deepStrictEqual(VIEW_PARTS.menus['view/item/context']?.slice(0, 2), [
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

  it('F-0902 3.1, 3.3: Start, Stop and Remove are out of the palette; the row menu and the inline bar carry the actions of the tokens in the groups of the reference, and the three commands of containers-104 stay shut with false', () => {
    deepStrictEqual(
      [
        VIEW_PARTS.menus['view/item/context']?.slice(2, -1),
        VIEW_PARTS.commands
          .map(entry => entry.command)
          .filter(command =>
            ['startContainer', 'stopContainer', 'removeContainer'].some(
              name => command === `remote-containers.${name}`,
            ),
          ),
      ],
      [
        ROW_ACTION_ENTRIES,
        [
          'remote-containers.startContainer',
          'remote-containers.stopContainer',
          'remote-containers.removeContainer',
        ],
      ],
    );
  });

  it('F-0902 3.1, containers-103: the two Open in Container commands are registered, and none of their row menu, inline or palette entries holds a staging false', () => {
    const opens = [
      'remote-containers.openFolderInContainerInCurrentWindow',
      'remote-containers.openFolderInContainerInNewWindow',
    ];
    const entries = [
      ...(VIEW_PARTS.menus['view/item/context'] ?? []),
      ...(VIEW_PARTS.menus.commandPalette ?? []),
    ].filter(entry => opens.includes(entry.command));
    deepStrictEqual(
      [
        VIEW_PARTS.commands
          .map(entry => entry.command)
          .filter(command => opens.includes(command)),
        entries.length,
        entries.filter(entry => / && false\b/.test(entry.when)).length,
      ],
      [opens, 6, 0],
    );
  });

  it('F-0902 3.1, containers-104: Show Details, Inspect and Show Container Log are registered, are in the row menu and the Image row, are out of the palette, and no menu entry is staged', () => {
    const names = [
      'remote-containers.showDetails',
      'remote-containers.inspectDockerResource',
      'remote-containers.showContainerLog',
    ];
    const menu = (VIEW_PARTS.menus['view/item/context'] ?? []).filter(entry =>
      names.includes(entry.command),
    );
    const palette = (VIEW_PARTS.menus.commandPalette ?? []).filter(entry =>
      names.includes(entry.command),
    );
    deepStrictEqual(
      [
        VIEW_PARTS.commands
          .map(entry => entry.command)
          .filter(command => names.includes(command)),
        menu.length,
        menu.filter(entry => / && false\b/.test(entry.when)),
        palette.map(entry => entry.when),
      ],
      [names, 4, [], ['false', 'false', 'false']],
    );
  });

  it('F-1406.5: package.nls.json holds the card’s keys with their texts, every key package.json uses is one of them, and every key it holds is used', () => {
    const table = readJson('package.nls.json');
    const used = new Set(
      [...JSON.stringify(MANIFEST).matchAll(/%([^%"]+)%/g)].map(
        match => match[1],
      ),
    );
    partialDeepStrictEqual(table, ENGLISH);
    deepStrictEqual(
      {
        unresolved: [...used].filter(
          key => key === undefined || !(key in table),
        ),
        unused: Object.keys(table).filter(key => !used.has(key)),
      },
      {unresolved: [], unused: []},
    );
  });

  it('F-1406.5: every locale of identifiers.json has a table and a runtime bundle with the English values', () => {
    const locales = (readJson('identifiers.json').locales ?? []) as string[];
    const bundle = Object.keys(readJson('l10n/bundle.l10n.json'));
    deepStrictEqual(
      [
        locales.length > 0,
        locales.map(locale => [
          readJson(`package.nls.${locale}.json`),
          readJson(`l10n/bundle.l10n.${locale}.json`),
        ]),
      ],
      [
        true,
        locales.map(() => [
          readJson('package.nls.json'),
          Object.fromEntries(bundle.map(text => [text, text])),
        ]),
      ],
    );
  });

  it('F-1406.5: identifiers.json names the identity of the family and the identifiers the card lists', () => {
    partialDeepStrictEqual(readJson('identifiers.json'), {
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
    });
  });
});
