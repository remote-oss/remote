/**
 * @fileoverview The manifest of the Remote - SSH package (card remote-ssh-01): the top-level fields, the
 * contributions, the string tables, and the generated identifier table.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {
  authorities,
  commands,
  contextKeys,
  internalCommands,
  settings,
  standDown,
} from '../../src/identifiers.generated.ts';

const PACKAGE = path.join(import.meta.dirname, '..', '..');
const DESCRIPTION =
  'Work on any machine you can reach over SSH as if the code were on your own disk.';
const EDITOR_ENGINE = '^1.139.0';

/** The standing-down key every gated when clause negates. */
const STANDING_DOWN = '!opensshremotes.standingDown';

/** The palette when of each command, the inventory's clause plus the gated key. */
const PALETTE_WHEN: Record<string, string> = {
  'opensshremotes.cleanCurrentRemoteServer':
    'remoteName =~ /^ssh-remote$/ && remoteConnectionState == connected && !opensshremotes.standingDown',
  'opensshremotes.cleanLocalServer':
    'config.remote.SSH.useLocalServer && !opensshremotes.standingDown',
  'opensshremotes.getStarted':
    '!remoteName && !virtualWorkspace && !opensshremotes.standingDown || remoteName =~ /^ssh-remote$/ && remoteConnectionState == disconnected && !opensshremotes.standingDown',
  'opensshremotes.openEmptyWindowOnCurrentHost':
    'remoteName =~ /^ssh-remote$/ && remoteConnectionState == connected && !opensshremotes.standingDown',
  'opensshremotes.openWebUI':
    'remoteName =~ /^ssh-remote$/ && remoteConnectionState == connected && config.remote.SSH.enableWebAccess && !opensshremotes.standingDown',
  'opensshremotes.provideFeedback':
    'remoteName =~ /^ssh-remote$/ && !opensshremotes.standingDown',
};

/** The manifest read by the tests. */
interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  displayName?: string;
  publisher?: string;
  description?: string;
  license?: string;
  repository?: unknown;
  bugs?: unknown;
  keywords?: string[];
  engines?: {vscode?: string};
  extensionKind?: string[];
  capabilities?: unknown;
  main?: string;
  api?: unknown;
  enabledApiProposals?: string[];
  activationEvents?: string[];
  extensionPack?: string[];
  extensionDependencies?: unknown;
  contributes?: {
    commands?: Array<Record<string, unknown>>;
    configuration?: {
      title?: string;
      properties?: Record<string, Record<string, unknown>>;
    };
    menus?: Record<string, Array<Record<string, unknown>>>;
    resourceLabelFormatters?: Array<Record<string, unknown>>;
    remoteHelp?: Record<string, unknown>;
  };
}

/** A generated-table entry: an id plus whatever the kind carries. */
type TableEntry = {id: string} & Record<string, unknown>;

/** Reads a JSON file of the package. */
function read(file: string): unknown {
  return JSON.parse(readFileSync(path.join(PACKAGE, file), 'utf8'));
}

/** The English string table. */
function englishTable(): Record<string, unknown> {
  return read('package.nls.json') as Record<string, unknown>;
}

/** The name inside a `%name%` reference, or null when the value is not a key. */
function nlsKey(value: unknown): string | null {
  return /^%[\w.]+%$/.test(String(value)) ? String(value).slice(1, -1) : null;
}

function manifest(): Manifest {
  return read('package.json') as Manifest;
}

/** Every package.nls file (the base and each locale), keyed by file name. */
function nlsTables(): Map<string, Record<string, unknown>> {
  const tables = new Map<string, Record<string, unknown>>();
  for (const file of readdirSync(PACKAGE)) {
    if (/^package\.nls(\..+)?\.json$/.test(file)) {
      tables.set(file, read(file) as Record<string, unknown>);
    }
  }
  return tables;
}

/** Every `%key%` reference of the manifest's strings, in first-occurrence order. */
function manifestKeys(): string[] {
  const found = new Map<string, string>();
  for (const match of JSON.stringify(manifest()).matchAll(/%([\w.]+)%/g)) {
    found.set(String(match[1]), match[0]);
  }
  return [...found.keys()];
}

const INVENTORY_FIXTURE = path.join(
  import.meta.dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'identity-inventory.json',
);

/** A setting of the inventory fixture, the fields the fidelity row compares. */
interface InventorySetting {
  key: string;
  declared?: boolean;
  type: string | string[];
  default?: unknown;
  scope?: string;
  descriptionForm?: string;
  enum?: unknown[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  tags?: string[];
  items?: Record<string, unknown>;
  additionalProperties?: Record<string, unknown>;
  deprecationMessage?: string;
  markdownDeprecationMessage?: string;
  description: string;
}

/** A command of the inventory fixture. */
interface InventoryCommand {
  id: string;
  title: string;
  category: string;
  enablement?: string | null;
  icon?: string;
}

interface InventoryFixture {
  settings: InventorySetting[];
  commands: InventoryCommand[];
  menus: Array<{menu: string; command: string; group?: string; when: string}>;
  remoteHelp: Record<string, unknown>;
}

/** The inventory fixture, read once. */
function inventory(): InventoryFixture {
  const fixture = JSON.parse(
    readFileSync(INVENTORY_FIXTURE, 'utf8'),
  ) as InventoryFixture;
  return fixture;
}

/** The fields of a setting schema the fidelity row compares, with a single-element type array unwrapped. */
function settingFields(
  value: Record<string, unknown>,
  typeArray?: string[],
): Record<string, unknown> {
  return {
    type:
      typeArray !== undefined
        ? typeArray.length === 1
          ? typeArray[0]
          : typeArray
        : value.type,
    default: value.default,
    scope: value.scope,
    enum: value.enum,
    enumDescriptions: value.enumDescriptions,
    minimum: value.minimum,
    maximum: value.maximum,
    pattern: value.pattern,
    tags: value.tags,
    items: value.items,
    additionalProperties: value.additionalProperties,
    deprecationMessage: value.deprecationMessage,
    markdownDeprecationMessage: value.markdownDeprecationMessage,
  };
}

/** Which field holds a setting's description text. */
function descriptionForm(schema: Record<string, unknown>): string {
  return schema.markdownDescription !== undefined
    ? 'markdownDescription'
    : 'description';
}

describe('manifest (card remote-ssh-01 table)', () => {
  it('manifest top-level fields: the card values, one by one', () => {
    const fields = manifest();
    deepStrictEqual(
      {
        name: fields.name,
        publisher: fields.publisher,
        displayName: fields.displayName,
        description: fields.description,
        version: fields.version,
        private: fields.private,
        keywords: fields.keywords,
        repository: fields.repository,
        bugs: fields.bugs,
        license: fields.license,
        enginesVscode: fields.engines?.vscode,
        extensionKind: fields.extensionKind,
        capabilities: fields.capabilities,
        main: fields.main,
        apiField: Object.hasOwn(fields, 'api') ? fields.api : undefined,
      },
      {
        name: 'remote-ssh',
        publisher: 'remote-oss',
        displayName: 'Remote - SSH',
        description: '%description%',
        version: '0.1.0',
        private: true,
        keywords: ['remote development', 'remote', 'ssh'],
        repository: {
          type: 'git',
          url: 'https://github.com/remote-oss/remote.git',
          directory: 'packages/remote-ssh',
        },
        bugs: {url: 'https://github.com/remote-oss/remote/issues'},
        license: 'MIT',
        enginesVscode: EDITOR_ENGINE,
        extensionKind: ['ui'],
        capabilities: {untrustedWorkspaces: {supported: true}},
        main: './dist/extension.js',
        apiField: undefined,
      },
    );
  });

  it('activationEvents: the seven, in order, with no wildcards or startup', () => {
    deepStrictEqual(manifest().activationEvents, [
      'onCommand:remote-internal.getSshFoldersHistory',
      'onCommand:remote-internal.deleteSshFolderFromHistory',
      'onCommand:remote-internal.getActiveSshRemote',
      'onCommand:remote-internal.getConfiguredHostnames',
      'onCommand:remote-internal.openRemoteSshTarget',
      'onResolveRemoteAuthority:ssh-remote',
      'onUri',
    ]);
  });

  it('extensionPack: the two ids; extensionDependencies absent', () => {
    const fields = manifest();
    deepStrictEqual(
      {
        extensionPack: fields.extensionPack,
        extensionDependencies: fields.extensionDependencies,
      },
      {
        extensionPack: [
          'remote-oss.remote-ssh-edit',
          'remote-oss.remote-explorer',
        ],
        extensionDependencies: undefined,
      },
    );
  });

  it('enabledApiProposals: the four, in any order', () => {
    deepStrictEqual([...(manifest().enabledApiProposals ?? [])].sort(), [
      'contribRemoteHelp',
      'resolvers',
      'terminalDataWriteEvent',
      'tunnels',
    ]);
  });

  it('commands: 17, every category, every title a key, no enablement, no internal ids', () => {
    const contributed = manifest().contributes?.commands ?? [];
    deepStrictEqual(
      {
        count: contributed.length,
        categories:
          new Set(contributed.map(command => String(command.category))).size ===
          1
            ? String(contributed[0]?.category)
            : 'mixed',
        titlesAreKeys: contributed.every(command =>
          /^%[\w.]+%$/.test(String(command.title)),
        ),
        enablements: contributed.every(
          command => command.enablement === undefined,
        ),
        idPrefixes: contributed.every(command =>
          String(command.command).startsWith('opensshremotes.'),
        ),
        internalIds: contributed.every(
          command => !String(command.command).startsWith('remote-internal.'),
        ),
        uniqueIds: new Set(contributed.map(command => String(command.command)))
          .size,
        contributedIds: contributed
          .map(command => String(command.command))
          .sort(),
      },
      {
        count: 17,
        categories: 'Remote-SSH',
        titlesAreKeys: true,
        enablements: true,
        idPrefixes: true,
        internalIds: true,
        uniqueIds: 17,
        contributedIds: (Object.values(commands) as TableEntry[])
          .map(entry => entry.id)
          .sort(),
      },
    );
  });

  it('settings: the 35 declared, the pruned key absent, the invented key a schema', () => {
    const configuration = manifest().contributes?.configuration;
    const properties = configuration?.properties ?? {};
    const invented = properties['remote.SSH.serverDownloadUrlTemplate'] ?? {};
    deepStrictEqual(
      {
        title: configuration?.title,
        count: Object.keys(properties).length,
        prefixes: Object.keys(properties).every(settingKey =>
          settingKey.startsWith('remote.SSH.'),
        ),
        descriptionFormsAreKeys: Object.values(properties).every(schema =>
          /^%[\w.]+%$/.test(
            String(schema.markdownDescription ?? schema.description),
          ),
        ),
        prunedKeyPresent: 'remote.SSH.experimental.chat' in properties,
        invented: {
          type: invented.type,
          default: invented.default,
          scope: invented.scope,
          descriptionIsKey: /^%[\w.]+%$/.test(
            String(invented.markdownDescription ?? invented.description),
          ),
        },
        keys: Object.keys(properties).sort(),
        tableKeys: (Object.values(settings) as TableEntry[])
          .map(entry => entry.id)
          .sort(),
      },
      {
        title: 'Remote - SSH',
        count: 35,
        prefixes: true,
        descriptionFormsAreKeys: true,
        prunedKeyPresent: false,
        invented: {
          type: 'string',
          default: undefined,
          scope: 'application',
          descriptionIsKey: true,
        },
        keys: (Object.values(settings) as TableEntry[])
          .map(entry => entry.id)
          .sort(),
        tableKeys: (Object.values(settings) as TableEntry[])
          .map(entry => entry.id)
          .sort(),
      },
    );
  });

  it('menus: 8 entries, the indicator groups, every when gated, the key nowhere else', () => {
    const contributes = manifest().contributes;
    const menus = contributes?.menus ?? {};
    const stripped = JSON.stringify({
      ...(contributes ?? {}),
      menus: {},
    });
    deepStrictEqual(
      {
        menuNames: Object.keys(menus).sort(),
        indicator: (menus['statusBar/remoteIndicator'] ?? []).map(entry => [
          entry.command,
          entry.group,
          entry.when,
        ]),
        palette: (menus.commandPalette ?? []).map(entry => [
          entry.command,
          entry.when,
        ]),
        standingDownKeyOutsideMenus: stripped.includes(
          'opensshremotes.standingDown',
        ),
      },
      {
        menuNames: ['commandPalette', 'statusBar/remoteIndicator'],
        indicator: [
          [
            'opensshremotes.openEmptyWindow',
            'remote_20_ssh-remote_1general@1',
            STANDING_DOWN,
          ],
          [
            'opensshremotes.openEmptyWindowInCurrentWindow',
            'remote_20_ssh-remote_1general@2',
            STANDING_DOWN,
          ],
        ],
        palette: [
          [
            'opensshremotes.getStarted',
            PALETTE_WHEN['opensshremotes.getStarted'],
          ],
          [
            'opensshremotes.openEmptyWindowOnCurrentHost',
            PALETTE_WHEN['opensshremotes.openEmptyWindowOnCurrentHost'],
          ],
          [
            'opensshremotes.provideFeedback',
            PALETTE_WHEN['opensshremotes.provideFeedback'],
          ],
          [
            'opensshremotes.cleanCurrentRemoteServer',
            PALETTE_WHEN['opensshremotes.cleanCurrentRemoteServer'],
          ],
          [
            'opensshremotes.cleanLocalServer',
            PALETTE_WHEN['opensshremotes.cleanLocalServer'],
          ],
          [
            'opensshremotes.openWebUI',
            PALETTE_WHEN['opensshremotes.openWebUI'],
          ],
        ],
        standingDownKeyOutsideMenus: false,
      },
    );
  });

  it('resourceLabelFormatters: the one entry, exact', () => {
    deepStrictEqual(manifest().contributes?.resourceLabelFormatters, [
      {
        scheme: 'vscode-remote',
        authority: 'ssh-remote+*',
        formatting: {
          label: '${path}',
          separator: '/',
          tildify: true,
          workspaceSuffix: 'SSH',
        },
      },
    ]);
  });

  it('remoteHelp: the flat object with remoteName and the four urls', () => {
    deepStrictEqual(manifest().contributes?.remoteHelp, {
      remoteName: ['ssh-remote'],
      getStarted:
        'https://github.com/remote-oss/remote/blob/main/docs/remote-ssh/getting-started.md',
      documentation:
        'https://github.com/remote-oss/remote/tree/main/docs/remote-ssh',
      feedback: 'https://github.com/remote-oss/remote/issues/new/choose',
      issues:
        'https://github.com/remote-oss/remote/issues?q=is%3Aissue%20label%3Aext%3Aremote-ssh',
    });
  });

  it('nls parity: 15 files, the same key set, every manifest key resolved in each', () => {
    const tables = nlsTables();
    const base = tables.get('package.nls.json') ?? {};
    const keys = Object.keys(base).sort();
    const manifestKeySet = new Set(manifestKeys());
    deepStrictEqual(
      {
        fileCount: tables.size,
        keyCount: keys.length,
        keySetsMatch: [...tables].every(([, table]) =>
          deepEqualStrings(Object.keys(table).sort(), keys),
        ),
        valuesAreStrings: [...tables].every(([, table]) =>
          Object.values(table).every(value => typeof value === 'string'),
        ),
        description: base.description,
        manifestReferencesEveryKey: keys.every(settingKey =>
          manifestKeySet.has(settingKey),
        ),
      },
      {
        fileCount: 15,
        keyCount: 53,
        keySetsMatch: true,
        valuesAreStrings: true,
        description: DESCRIPTION,
        manifestReferencesEveryKey: true,
      },
    );
  });

  it('forbidden words: none in an nls value, the card list without session', () => {
    const forbidden = [
      'reference',
      'Microsoft',
      'ms-vscode',
      'clean-room',
      'reimplement',
      'spec',
      'worker',
      'lab',
    ];
    const offenders = [...nlsTables()].flatMap(([file, table]) =>
      Object.entries(table).flatMap(([entryKey, value]) => {
        const hits = forbidden.filter(word =>
          new RegExp(`\\b${word}\\b`, 'i').test(String(value)),
        );
        if (/\b[FRD]-\d/.test(String(value))) {
          hits.push('id-pattern');
        }
        return hits.map(word => `${file} ${entryKey}: ${word}`);
      }),
    );
    deepStrictEqual(offenders, []);
  });

  it('identifiers.json: the card fields', () => {
    const declared = read('identifiers.json') as {
      source: string;
      standsDownFor: string;
      standingDownKey: string;
      namespaces: Record<string, string[]>;
      contextKeys: Array<{id: string; setter: string}>;
      infoLineCommands: unknown[];
      internal: Array<{id: string; role: string; kind: string}>;
      invented: Array<{id: string; kind: string; spec: string; date: string}>;
      settingPairs: unknown[];
      ungated: unknown[];
      locales: string[];
    };
    // The date of each invented row is the date of this PR; the ids, kinds and specs are the contract.
    const declaredWithDatesProjected = {
      ...declared,
      invented: declared.invented.map(inventedRow => ({
        id: inventedRow.id,
        kind: inventedRow.kind,
        spec: inventedRow.spec,
      })),
    };
    deepStrictEqual(declaredWithDatesProjected, {
      source: 'remote-oss/remote-ssh#78 (F-3901)',
      standsDownFor: 'ms-vscode-remote.remote-ssh',
      standingDownKey: 'opensshremotes.standingDown',
      namespaces: {
        commands: ['opensshremotes.'],
        settings: ['remote.SSH.'],
        contextKeys: ['opensshremotes.'],
        internalCommands: ['remote-internal.'],
      },
      contextKeys: [{id: 'opensshremotes.standingDown', setter: 'extension'}],
      infoLineCommands: [],
      internal: [
        {
          id: 'remote-internal.getSshFoldersHistory',
          role: 'served',
          kind: 'query',
        },
        {
          id: 'remote-internal.deleteSshFolderFromHistory',
          role: 'served',
          kind: 'change',
        },
        {
          id: 'remote-internal.getActiveSshRemote',
          role: 'served',
          kind: 'query',
        },
        {
          id: 'remote-internal.getConfiguredHostnames',
          role: 'served',
          kind: 'query',
        },
        {
          id: 'remote-internal.openRemoteSshTarget',
          role: 'served',
          kind: 'change',
        },
        {id: 'remote-internal.sshHostsChanged', role: 'called', kind: 'change'},
        {id: 'remote-oss.gate.claim', role: 'called', kind: 'query'},
      ],
      invented: [
        {
          id: 'remote.SSH.serverDownloadUrlTemplate',
          kind: 'settings',
          spec: 'F-2403',
        },
        {
          id: 'opensshremotes.standingDown',
          kind: 'contextKeys',
          spec: 'F-2001',
        },
        {
          id: 'remote-internal.sshHostsChanged',
          kind: 'internalCommands',
          spec: 'F-2203',
        },
      ],
      settingPairs: [],
      ungated: [],
      locales: [
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
      ],
    });
  });

  it('inventory fidelity: every setting, command, menu and remoteHelp matches the inventory', () => {
    const {settings, commands, menus, remoteHelp} = inventory();
    const nlsTable = nlsTables().get('package.nls.json') ?? {};
    const properties = manifest().contributes?.configuration?.properties ?? {};
    const menuEntries = Object.entries(
      manifest().contributes?.menus ?? {},
    ).flatMap(([menu, entries]) =>
      entries.map(entry => ({
        menu,
        command: String(entry.command),
        entry,
      })),
    );
    deepStrictEqual(
      {
        settings: settings
          .filter(settingRow => settingRow.declared !== false)
          .map(settingRow => {
            const schema = properties[settingRow.key] ?? {};
            const descriptionKey = nlsKey(schema[descriptionForm(schema)]);
            return {
              key: settingRow.key,
              fields: settingFields(schema, settingRow.type as string[]),
              form: descriptionForm(schema),
              formIsKey: descriptionKey !== null,
              nlsValue:
                descriptionKey === null ? null : englishTable()[descriptionKey],
            };
          }),
        commands: commands.map(commandRow => {
          const entry = (manifest().contributes?.commands ?? []).find(
            command => String(command.command) === commandRow.id,
          );
          const titleKey = String(entry?.title).replace(/^%|%/g, '');
          const title =
            typeof nlsTable[titleKey] === 'string' ? nlsTable[titleKey] : '';
          return {
            id: commandRow.id,
            title,
            category: String(entry?.category),
            enablement: entry?.enablement ?? null,
            icon: entry?.icon ?? null,
          };
        }),
        menus: menuEntries.map(menuRow => ({
          menu: menuRow.menu,
          command: menuRow.command,
          group: menuRow.entry.group,
          when: menuRow.entry.when,
        })),
        remoteHelp: manifest().contributes?.remoteHelp,
      },
      {
        settings: settings
          .filter(settingRow => settingRow.declared !== false)
          .map(settingRow => ({
            key: settingRow.key,
            fields: settingFields(
              settingRow as unknown as Record<string, unknown>,
              settingRow.type as string[],
            ),
            form:
              settingRow.descriptionForm === 'markdownDescription'
                ? 'markdownDescription'
                : 'description',
            formIsKey: true,
            nlsValue: settingRow.description,
          })),
        commands: commands.map(commandRow => ({
          id: commandRow.id,
          title: commandRow.title,
          category: commandRow.category,
          enablement: commandRow.enablement ?? null,
          icon: commandRow.icon ?? null,
        })),
        menus: menus.map(menuRow => ({
          menu: menuRow.menu,
          command: menuRow.command,
          group: menuRow.group,
          when: menuRow.when,
        })),
        remoteHelp,
      },
    );
  });

  it('the generated table: the ids of the manifest, the keys, the authority and the stand-down', () => {
    const manifestCommands = (manifest().contributes?.commands ?? []).map(
      command => String(command.command),
    );
    const manifestSettings = Object.keys(
      manifest().contributes?.configuration?.properties ?? {},
    );
    deepStrictEqual(
      {
        commandIds: (Object.values(commands) as TableEntry[])
          .map(entry => entry.id)
          .sort(),
        settingIds: (Object.values(settings) as TableEntry[])
          .map(entry => entry.id)
          .sort(),
        contextKey: contextKeys.standingDown as unknown,
        authority: authorities.sshRemote,
        internalCount: Object.keys(internalCommands).length,
        standDown,
      },
      {
        commandIds: [...manifestCommands].sort(),
        settingIds: [...manifestSettings].sort(),
        contextKey: {id: 'opensshremotes.standingDown', setter: 'extension'},
        authority: 'ssh-remote',
        internalCount: 7,
        standDown: {
          standsDownFor: 'ms-vscode-remote.remote-ssh',
          contextKey: 'opensshremotes.standingDown',
        },
      },
    );
  });
});

/** Whether two sorted key lists are equal, without a nested assertion. */
function deepEqualStrings(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((entry, position) => entry === expected[position])
  );
}
