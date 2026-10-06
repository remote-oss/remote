/**
 * @fileoverview Builds a package's generated identifier table (ADR draft "Identifier tables", contracts §1.1): one
 * exported object per non-empty kind, from a descriptive name to the literal id or to the id's entry.
 */

import type {PackageSources} from './identifier-sources.ts';

/** The file the generator writes into a package, relative to the package folder. */
export const TABLE_FILE = 'src/identifiers.generated.ts';

/** A value of a table entry: a literal, or an object of literals. */
type TableValue = string | Record<string, string | boolean>;

/** One exported object of the table. */
interface TableKind {
  name: string;
  documentation: string;
  entries: Map<string, TableValue>;
}

const MINIMUM_NAME_LENGTH = 4;

function isCapitalRun(word: string): boolean {
  return /^[A-Z0-9]+$/.test(word);
}

function capitalized(word: string): string {
  const lower = isCapitalRun(word) ? word.toLowerCase() : word;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The camel-case name made from the last `count` dot-separated segments of `identifier`. */
function nameFromSegments(identifier: string, count: number): string {
  const [first = '', ...rest] = identifier
    .split('.')
    .slice(-count)
    .flatMap(segment => segment.split(/[^A-Za-z0-9]+/))
    .filter(word => word !== '');
  const head = isCapitalRun(first)
    ? first.toLowerCase()
    : first.charAt(0).toLowerCase() + first.slice(1);
  return head + rest.map(capitalized).join('');
}

function isUsableName(name: string): boolean {
  return name.length >= MINIMUM_NAME_LENGTH && /^[a-z]/.test(name);
}

/** An id on its way to a name, with the number of segments the name uses so far. */
interface NameCandidate<T> {
  identifier: string;
  value: T;
  count: number;
  name: string;
}

/**
 * Keys each id's value by the id's descriptive name: the camel case of its last dot-separated segment, widened by
 * one segment at a time while the name is shorter than four characters, does not start with a letter, or is shared
 * with another id of the same kind. Throws when an id runs out of segments.
 */
export function descriptiveNames<T>(
  values: ReadonlyMap<string, T>,
): Map<string, T> {
  const candidates: Array<NameCandidate<T>> = [...values].map(
    ([identifier, value]) => ({
      identifier,
      value,
      count: 1,
      name: nameFromSegments(identifier, 1),
    }),
  );
  for (;;) {
    const owners = new Map<string, number>();
    for (const candidate of candidates) {
      owners.set(candidate.name, (owners.get(candidate.name) ?? 0) + 1);
    }
    const widen = candidates.filter(
      candidate =>
        !isUsableName(candidate.name) || owners.get(candidate.name) !== 1,
    );
    if (widen.length === 0) {
      return new Map(
        candidates.map(candidate => [candidate.name, candidate.value]),
      );
    }
    for (const candidate of widen) {
      if (candidate.count >= candidate.identifier.split('.').length) {
        throw new Error(
          `no descriptive name for '${candidate.identifier}': its segments give '${candidate.name}', which is too short, not a name, or shared`,
        );
      }
      candidate.count += 1;
      candidate.name = nameFromSegments(candidate.identifier, candidate.count);
    }
  }
}

function tableKind(
  name: string,
  documentation: string,
  values: ReadonlyMap<string, TableValue>,
): TableKind {
  return {name, documentation, entries: descriptiveNames(values)};
}

function plainIds(identifiers: readonly string[]): Map<string, TableValue> {
  return new Map(identifiers.map(identifier => [identifier, identifier]));
}

/** The kinds of a package's table, in a fixed order, leaving out every empty kind. */
export function tableKinds(sources: PackageSources): TableKind[] {
  const {manifest, declared} = sources;
  const infoLine = new Set(declared.infoLineCommands);
  const legacyOf = new Map(
    declared.settingPairs.map(pair => [pair.current, pair]),
  );
  const legacyKeys = new Set(declared.settingPairs.map(pair => pair.legacy));
  const contextKeys = new Map<string, TableValue>(
    declared.contextKeys.map(contextKey => [
      contextKey.id,
      {id: contextKey.id, setter: contextKey.setter},
    ]),
  );
  if (declared.standingDownKey !== '') {
    contextKeys.set(declared.standingDownKey, {
      id: declared.standingDownKey,
      setter: 'extension',
    });
  }
  const kinds = [
    tableKind(
      'commands',
      'The commands of `contributes.commands`: title as written, palette visibility, R-46 policy.',
      new Map(
        manifest.commands.map(command => [
          command.id,
          {
            id: command.id,
            title: command.title,
            palette: command.palette,
            policy: infoLine.has(command.id) ? 'infoLine' : 'silent',
          },
        ]),
      ),
    ),
    tableKind(
      'settings',
      'The settings of `contributes.configuration`, each with its legacy twin and the winner.',
      new Map(
        manifest.settings
          .filter(setting => !legacyKeys.has(setting.id))
          .map(setting => {
            const pair = legacyOf.get(setting.id);
            return [
              setting.id,
              {
                id: setting.id,
                scope: setting.scope,
                ...(pair === undefined
                  ? {}
                  : {legacyId: pair.legacy, winner: pair.winner}),
              },
            ];
          }),
      ),
    ),
    tableKind(
      'contextKeys',
      'The context keys of identifiers.json, each with the side that sets it.',
      contextKeys,
    ),
    tableKind(
      'views',
      'The view ids of `contributes.views`.',
      plainIds(manifest.views),
    ),
    tableKind(
      'authorities',
      'The authorities of the `onResolveRemoteAuthority:` activation events.',
      plainIds(manifest.authorities),
    ),
    tableKind(
      'languages',
      'The language ids of `contributes.languages`.',
      plainIds(manifest.languages),
    ),
    tableKind(
      'internalCommands',
      'The internal command ids of identifiers.json (F-5902 §5).',
      new Map(
        declared.internal.map(command => [
          command.id,
          {id: command.id, role: command.role, kind: command.kind},
        ]),
      ),
    ),
  ];
  if (declared.reference !== '' && declared.standingDownKey !== '') {
    kinds.push({
      name: 'standDown',
      documentation:
        'The reference extension and the standing-down key (R-54).',
      entries: new Map<string, TableValue>([
        ['reference', declared.reference],
        ['contextKey', declared.standingDownKey],
      ]),
    });
  }
  return kinds.filter(kind => kind.entries.size > 0);
}

function literal(value: TableValue): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  const fields = Object.entries(value).map(
    ([field, fieldValue]) => `${field}: ${JSON.stringify(fieldValue)}`,
  );
  return `{${fields.join(', ')}}`;
}

/**
 * The source text of a package's table, unformatted, or undefined when every kind is empty and the package gets
 * no table.
 */
export function tableSource(sources: PackageSources): string | undefined {
  const kinds = tableKinds(sources);
  if (kinds.length === 0) {
    return undefined;
  }
  const exports = kinds.map(kind => {
    const entries = [...kind.entries].map(
      ([name, value]) => `  ${name}: ${literal(value)},`,
    );
    return `/** ${kind.documentation} */\nexport const ${kind.name} = {\n${entries.join('\n')}\n} as const;\n`;
  });
  return [
    '/**',
    ` * @fileoverview The identifiers of packages/${sources.folder}, generated by tools/identifiers.ts from its`,
    ' * package.json and identifiers.json. `pnpm identifiers` writes it again.',
    ' */',
    '',
    exports.join('\n'),
  ].join('\n');
}
