/**
 * @fileoverview Reads the two sources of a package's identifiers (ADR draft "Identifier tables"): the manifest
 * `package.json`, which contributes them, and the hand-written `identifiers.json`, which holds what the manifest
 * cannot say: the stand-down identity, the context keys, the policy for commands invoked outside their context, the internal ids,
 * the ledger of invented identifiers, the
 * legacy setting pairs and the locales.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {isLibraryFolder, messageOf} from './repository.ts';

/** The kinds an invented identifier or a namespace belongs to. */
const LEDGER_KINDS = [
  'commands',
  'settings',
  'contextKeys',
  'views',
  'internalCommands',
] as const;

/** One of LEDGER_KINDS. */
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** A command of `contributes.commands`. */
interface ContributedCommand {
  id: string;
  /** The title as the manifest writes it, a `%key%` reference included. */
  title: string;
  /** False when `menus.commandPalette` hides the command with `when: "false"`. */
  palette: boolean;
}

/** A setting of `contributes.configuration`. */
interface ContributedSetting {
  id: string;
  /** The declared scope, `window` when the manifest names none (the editor's default). */
  scope: string;
}

/** One entry of a menu, of `viewsWelcome` or of `continueEditSession`: the contributions the stand-down key gates. */
export interface MenuEntry {
  menu: string;
  /** The command or submenu the entry shows, or the view of a welcome entry. */
  item: string;
  when?: string;
}

/** What the manifest contributes, reduced to the identifiers. */
export interface ManifestIdentifiers {
  commands: ContributedCommand[];
  settings: ContributedSetting[];
  views: string[];
  authorities: string[];
  languages: string[];
  activationEvents: string[];
  menuEntries: MenuEntry[];
  /** The proposed APIs the manifest enables, in its order. */
  enabledApiProposals: string[];
  /** Every `%key%` reference in the manifest's strings. */
  stringReferences: string[];
}

/** A context key of the package, and who sets it. */
interface DeclaredContextKey {
  id: string;
  setter: 'extension' | 'core';
}

/** An id core sees but the manifest does not contribute. */
interface InternalCommand {
  id: string;
  role: 'served' | 'called';
  kind: 'query' | 'change' | 'push';
  /** Whether the id activates the package: a served id that is false asks for no `onCommand:` event. */
  activates?: boolean;
}

/** A command id the extension registers at runtime only, never contributed. */
interface RuntimeCommand {
  id: string;
  purpose: string;
}

/** A row of the ledger of invented identifiers. */
interface InventedIdentifier {
  id: string;
  kind: LedgerKind;
  spec: string;
  date: string;
}

/** A current setting key and its legacy twin, with the side that wins when both are set. */
interface SettingPair {
  current: string;
  legacy: string;
  winner: 'current' | 'legacy';
}

/** A gated contribution that stays ungated, with the reason. */
export interface UngatedEntry {
  menu: string;
  item: string;
  reason: string;
}

/** The content of `identifiers.json`, with every optional list defaulted to empty. */
export interface DeclaredIdentifiers {
  /** The identity decision the file is reviewed against, as `owner/repo#issue (F-id)`. */
  source: string;
  /** The id of the extension this package stands down for when both are enabled. */
  standsDownFor: string;
  /**
   * Absent for a package that never stands down; empty while the identity decision has not
   * named the key.
   */
  standingDownKey?: string;
  namespaces: Partial<Record<LedgerKind, string[]>>;
  contextKeys: DeclaredContextKey[];
  infoLineCommands: string[];
  internal: InternalCommand[];
  runtimeCommands: RuntimeCommand[];
  invented: InventedIdentifier[];
  settingPairs: SettingPair[];
  ungated: UngatedEntry[];
  /** The locales the package ships string tables for; absent when the package states none. */
  locales?: string[];
}

/** Both sources of one package. */
export interface PackageSources {
  folder: string;
  manifest: ManifestIdentifiers;
  declared: DeclaredIdentifiers;
}

/** The sources of a package as found: `declared` is absent when the package has no identifiers.json. */
export interface FoundSources extends Omit<PackageSources, 'declared'> {
  declared?: DeclaredIdentifiers;
}

/** The name of the hand-written source in each package folder. */
export const DECLARED_FILE = 'identifiers.json';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON value read with its location, so that every shape error names where it is. */
class JsonCursor {
  readonly value: unknown;
  readonly where: string;

  constructor(value: unknown, where: string) {
    this.value = value;
    this.where = where;
  }

  fail(expected: string): never {
    throw new Error(`${this.where} must be ${expected}`);
  }

  field(name: string): JsonCursor {
    const object = this.object();
    return new JsonCursor(object[name], `${this.where}.${name}`);
  }

  isAbsent(): boolean {
    return this.value === undefined;
  }

  object(): JsonObject {
    return isObject(this.value) ? this.value : this.fail('an object');
  }

  nonEmptyString(): string {
    const text = this.string();
    return text.trim() === '' ? this.fail('a non-empty string') : text;
  }

  boolean(): boolean {
    return typeof this.value === 'boolean'
      ? this.value
      : this.fail('a boolean');
  }

  string(): string {
    return typeof this.value === 'string' ? this.value : this.fail('a string');
  }

  oneOf<T extends string>(allowed: readonly T[]): T {
    const text = this.string();
    const match = allowed.find(candidate => candidate === text);
    return match ?? this.fail(`one of ${allowed.join(', ')}`);
  }

  items(): JsonCursor[] {
    if (!Array.isArray(this.value)) {
      return this.fail('an array');
    }
    return this.value.map(
      (item: unknown, position) =>
        new JsonCursor(item, `${this.where}[${String(position)}]`),
    );
  }

  /** The items of an array, or none when the value is absent. */
  optionalItems(): JsonCursor[] {
    return this.isAbsent() ? [] : this.items();
  }

  /** Fails when the object has a field outside `known`. */
  onlyFields(known: readonly string[]): this {
    const unknown = Object.keys(this.object()).filter(
      name => !known.includes(name),
    );
    if (unknown.length > 0) {
      throw new Error(
        `${this.where} has unknown fields: ${unknown.join(', ')}`,
      );
    }
    return this;
  }
}

function readJson(file: string, where: string): JsonCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${where} is not valid JSON: ${messageOf(error)}`, {
      cause: error,
    });
  }
  return new JsonCursor(parsed, where);
}

function readCommands(
  contributes: JsonCursor,
  hidden: Set<string>,
): ContributedCommand[] {
  return contributes
    .field('commands')
    .optionalItems()
    .map(command => {
      const commandId = command.field('command').string();
      return {
        id: commandId,
        title: command.field('title').string(),
        palette: !hidden.has(commandId),
      };
    });
}

function readSettings(contributes: JsonCursor): ContributedSetting[] {
  const configuration = contributes.field('configuration');
  const sections = Array.isArray(configuration.value)
    ? configuration.items()
    : configuration.isAbsent()
      ? []
      : [configuration];
  return sections.flatMap(section => {
    const properties = section.field('properties');
    if (properties.isAbsent()) {
      return [];
    }
    return Object.keys(properties.object()).map(settingId => {
      const scope = properties.field(settingId).field('scope');
      return {
        id: settingId,
        scope: scope.isAbsent() ? 'window' : scope.string(),
      };
    });
  });
}

function readViews(contributes: JsonCursor): string[] {
  const views = contributes.field('views');
  if (views.isAbsent()) {
    return [];
  }
  return Object.keys(views.object()).flatMap(container =>
    views
      .field(container)
      .items()
      .map(view => view.field('id').string()),
  );
}

function readMenuEntries(contributes: JsonCursor): MenuEntry[] {
  const entries: MenuEntry[] = [];
  function addEntry(menu: string, entry: JsonCursor, itemField: string): void {
    const when = entry.field('when');
    entries.push({
      menu,
      item: entry.field(itemField).string(),
      ...(when.isAbsent() ? {} : {when: when.string()}),
    });
  }
  const menus = contributes.field('menus');
  for (const menu of menus.isAbsent() ? [] : Object.keys(menus.object())) {
    for (const entry of menus.field(menu).items()) {
      addEntry(
        menu,
        entry,
        entry.field('submenu').isAbsent() ? 'command' : 'submenu',
      );
    }
  }
  for (const entry of contributes.field('viewsWelcome').optionalItems()) {
    addEntry('viewsWelcome', entry, 'view');
  }
  for (const entry of contributes
    .field('continueEditSession')
    .optionalItems()) {
    addEntry('continueEditSession', entry, 'command');
  }
  return entries;
}

function stringReferencesIn(value: unknown): string[] {
  if (typeof value === 'string') {
    const match = /^%(.+)%$/.exec(value);
    return match?.[1] === undefined ? [] : [match[1]];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringReferencesIn);
  }
  return isObject(value)
    ? Object.values(value).flatMap(stringReferencesIn)
    : [];
}

const AUTHORITY_EVENT = 'onResolveRemoteAuthority:';

/** Reads the identifiers a manifest contributes; throws on a shape the editor would not accept. */
export function readManifest(file: string, where: string): ManifestIdentifiers {
  const manifest = readJson(file, where);
  const contributes = manifest.field('contributes');
  const contributions = contributes.isAbsent()
    ? new JsonCursor({}, contributes.where)
    : contributes;
  const menuEntries = readMenuEntries(contributions);
  const hidden = new Set(
    menuEntries
      .filter(
        entry => entry.menu === 'commandPalette' && entry.when === 'false',
      )
      .map(entry => entry.item),
  );
  const activationEvents = manifest
    .field('activationEvents')
    .optionalItems()
    .map(event => event.string());
  return {
    commands: readCommands(contributions, hidden),
    settings: readSettings(contributions),
    views: readViews(contributions),
    authorities: activationEvents
      .filter(event => event.startsWith(AUTHORITY_EVENT))
      .map(event => event.slice(AUTHORITY_EVENT.length)),
    languages: [
      ...new Set(
        contributions
          .field('languages')
          .optionalItems()
          .map(language => language.field('id').string()),
      ),
    ],
    activationEvents,
    menuEntries,
    enabledApiProposals: manifest
      .field('enabledApiProposals')
      .optionalItems()
      .map(proposal => proposal.string()),
    stringReferences: [...new Set(stringReferencesIn(manifest.value))],
  };
}

function readNamespaces(
  namespaces: JsonCursor,
): Partial<Record<LedgerKind, string[]>> {
  if (namespaces.isAbsent()) {
    return {};
  }
  namespaces.onlyFields(LEDGER_KINDS);
  const result: Partial<Record<LedgerKind, string[]>> = {};
  for (const kind of LEDGER_KINDS) {
    const prefixes = namespaces.field(kind);
    if (!prefixes.isAbsent()) {
      result[kind] = prefixes.items().map(prefix => prefix.string());
    }
  }
  return result;
}

const DECLARED_FIELDS = [
  'source',
  'standsDownFor',
  'standingDownKey',
  'namespaces',
  'contextKeys',
  'infoLineCommands',
  'internal',
  'runtimeCommands',
  'invented',
  'settingPairs',
  'ungated',
  'locales',
];

/** Reads a package's `identifiers.json`; throws on an unknown field or a value of the wrong shape. */
export function readDeclared(file: string, where: string): DeclaredIdentifiers {
  const declared = readJson(file, where).onlyFields(DECLARED_FIELDS);
  const standingDownKey = declared.field('standingDownKey');
  const locales = declared.field('locales');
  return {
    source: declared.field('source').nonEmptyString(),
    standsDownFor: declared.field('standsDownFor').string(),
    namespaces: readNamespaces(declared.field('namespaces')),
    contextKeys: declared
      .field('contextKeys')
      .optionalItems()
      .map(entry => ({
        id: entry.onlyFields(['id', 'setter']).field('id').string(),
        setter: entry.field('setter').oneOf(['extension', 'core'] as const),
      })),
    infoLineCommands: declared
      .field('infoLineCommands')
      .optionalItems()
      .map(entry => entry.string()),
    internal: declared
      .field('internal')
      .optionalItems()
      .map(entry => {
        const cursor = entry.onlyFields(['id', 'role', 'kind', 'activates']);
        const command: InternalCommand = {
          id: cursor.field('id').string(),
          role: cursor.field('role').oneOf(['served', 'called'] as const),
          kind: cursor
            .field('kind')
            .oneOf(['query', 'change', 'push'] as const),
        };
        const activates = cursor.field('activates');
        if (!activates.isAbsent()) {
          command.activates = activates.boolean();
        }
        return command;
      }),
    runtimeCommands: declared
      .field('runtimeCommands')
      .optionalItems()
      .map(entry => ({
        id: entry.onlyFields(['id', 'purpose']).field('id').string(),
        purpose: entry.field('purpose').nonEmptyString(),
      })),
    invented: declared
      .field('invented')
      .optionalItems()
      .map(entry => ({
        id: entry
          .onlyFields(['id', 'kind', 'spec', 'date'])
          .field('id')
          .string(),
        kind: entry.field('kind').oneOf(LEDGER_KINDS),
        spec: entry.field('spec').string(),
        date: entry.field('date').string(),
      })),
    settingPairs: declared
      .field('settingPairs')
      .optionalItems()
      .map(entry => ({
        current: entry
          .onlyFields(['current', 'legacy', 'winner'])
          .field('current')
          .string(),
        legacy: entry.field('legacy').string(),
        winner: entry.field('winner').oneOf(['current', 'legacy'] as const),
      })),
    ungated: declared
      .field('ungated')
      .optionalItems()
      .map(entry => ({
        menu: entry
          .onlyFields(['menu', 'item', 'reason'])
          .field('menu')
          .string(),
        item: entry.field('item').string(),
        reason: entry.field('reason').nonEmptyString(),
      })),
    ...(standingDownKey.isAbsent()
      ? {}
      : {standingDownKey: standingDownKey.string()}),
    ...(locales.isAbsent()
      ? {}
      : {locales: locales.items().map(locale => locale.string())}),
  };
}

/**
 * Whether a package folder needs `identifiers.json` and a generated table: an extension with code. A library
 * contributes no identifiers and stands down for nothing.
 */
export function needsIdentifiers(packageDirectory: string): boolean {
  return (
    !isLibraryFolder(path.basename(packageDirectory)) &&
    existsSync(path.join(packageDirectory, 'src'))
  );
}

/** Reads both sources of `packages/<folder>`; whether the package needs identifiers.json is the check's rule. */
export function readPackageSources(root: string, folder: string): FoundSources {
  const directory = path.join(root, 'packages', folder);
  const declaredFile = path.join(directory, DECLARED_FILE);
  const manifest = readManifest(
    path.join(directory, 'package.json'),
    `packages/${folder}/package.json`,
  );
  return existsSync(declaredFile)
    ? {
        folder,
        manifest,
        declared: readDeclared(
          declaredFile,
          `packages/${folder}/${DECLARED_FILE}`,
        ),
      }
    : {folder, manifest};
}
