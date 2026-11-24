/**
 * @fileoverview The locale tables of the package: the 14 generated nls tables and runtime bundles of F-6005, the
 * manifest references of AC-5, the bundles of AC-6, and the deliberately untranslated WSL text of BR-5.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

/** The 14 locales of BR-4, in the order the family's packages list them. */
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
function readTable(file: string): Record<string, unknown> {
  const text = readFileSync(path.join(PACKAGE, file), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

const MANIFEST = readTable('package.json') as {
  displayName?: unknown;
  description?: unknown;
  contributes: {
    commands: Array<Record<string, unknown>>;
    configuration: Record<string, unknown>;
    views: Record<string, Array<Record<string, unknown>>>;
    walkthrough?: Record<string, unknown>;
  };
};

const BASE_TABLE = readTable('package.nls.json');
const BASE_KEYS = new Set(Object.keys(BASE_TABLE));
const IDENTIFIERS = readTable('identifiers.json');

/** Whether two tables hold the same keys, in any order. */
function sameKeys(
  first: readonly string[],
  second: ReadonlySet<string>,
): boolean {
  return first.length === second.size && first.every(key => second.has(key));
}

/** The user-visible strings of the manifest, each by the contribution that holds it. */
function visibleStrings(): Map<string, string> {
  const found = new Map<string, string>();
  record(found, 'displayName', MANIFEST.displayName);
  record(found, 'description', MANIFEST.description);
  for (const [index, command] of MANIFEST.contributes.commands.entries()) {
    record(found, `commands.${String(index)}.title`, command.title);
    record(found, `commands.${String(index)}.category`, command.category);
  }
  const configuration = MANIFEST.contributes.configuration;
  record(found, 'configuration.title', configuration.title);
  const properties = configuration.properties as Record<
    string,
    Record<string, unknown>
  >;
  for (const [key, property] of Object.entries(properties)) {
    for (const field of [
      'description',
      'markdownDescription',
      'deprecationMessage',
      'markdownDeprecationMessage',
    ]) {
      record(found, `configuration.${key}.${field}`, property[field]);
    }
    const descriptions = (property.enumDescriptions ??
      []) as readonly unknown[];
    for (const [index, text] of descriptions.entries()) {
      record(
        found,
        `configuration.${key}.enumDescriptions.${String(index)}`,
        text,
      );
    }
  }
  for (const [menu, views] of Object.entries(MANIFEST.contributes.views)) {
    for (const [index, view] of views.entries()) {
      record(found, `views.${menu}.${String(index)}.name`, view.name);
    }
  }
  return found;
}

/** Records a user-visible string under the contribution that holds it; an empty string shows nothing. */
function record(
  found: Map<string, string>,
  where: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value !== '') {
    found.set(where, value);
  }
}

describe('the WSL locale tables (wsl.package)', () => {
  it('F-6005.AC-5: identifiers.json lists the 14 locales of BR-4, each has a nls table with the base key set, and every user-visible manifest string is a %key% reference except the configuration title WSL', () => {
    const tables = LOCALES.filter(
      locale =>
        !existsSync(path.join(PACKAGE, `package.nls.${locale}.json`)) ||
        !sameKeys(
          Object.keys(readTable(`package.nls.${locale}.json`)),
          BASE_KEYS,
        ),
    );
    const exceptions = new Map([['configuration.title', 'WSL']]);
    const unresolved = [...visibleStrings()].filter(([where, text]) => {
      const literal = exceptions.get(where);
      if (literal !== undefined) {
        return text !== literal;
      }
      const key = /^%([^%]+)%$/u.exec(text)?.[1];
      return key === undefined || !(key in BASE_TABLE);
    });
    deepStrictEqual(
      {
        locales: (IDENTIFIERS.locales ?? []) as unknown,
        pseudoLocalized: IDENTIFIERS.pseudoLocalized,
        tables,
        unresolved,
      },
      {locales: LOCALES, pseudoLocalized: true, tables: [], unresolved: []},
    );
  });

  it('F-6005.AC-6: each of the 14 locales has a runtime bundle with every key of the default bundle, and there is no bundle.l10n.en.json', () => {
    const defaultBundle = readTable('l10n/bundle.l10n.json');
    const defaultKeys = new Set(Object.keys(defaultBundle));
    const tables = LOCALES.filter(
      locale =>
        !existsSync(path.join(PACKAGE, 'l10n', `bundle.l10n.${locale}.json`)) ||
        !sameKeys(
          Object.keys(readTable(`l10n/bundle.l10n.${locale}.json`)),
          defaultKeys,
        ),
    );
    deepStrictEqual(
      {
        tables,
        english: existsSync(path.join(PACKAGE, 'l10n', 'bundle.l10n.en.json')),
      },
      {tables: [], english: false},
    );
  });

  it('F-6005.BR-5: displayName (and indicator.workspaceSuffix once it exists) reads WSL in every locale table, the pseudo-localized one keeping it too', () => {
    const kept = ['displayName', 'indicator.workspaceSuffix'].filter(
      key => key in BASE_TABLE,
    );
    const wrong: Array<[string, unknown[]]> = LOCALES.map(locale => [
      locale,
      kept.map(key => readTable(`package.nls.${locale}.json`)[key]),
    ]);
    deepStrictEqual(
      {
        kept: kept.length > 0,
        wrong: wrong.every(
          ([, values]) =>
            values.length > 0 && values.every(value => value === 'WSL'),
        ),
      },
      {kept: true, wrong: true},
    );
  });
});
