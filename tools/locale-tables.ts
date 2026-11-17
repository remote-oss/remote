/**
 * @fileoverview locale-tables: the locale string tables of the packages that ship them, generated from the default
 * tables and the hand-written translations.
 *
 *     node tools/locale-tables.ts            writes every package's locale tables
 *     node tools/locale-tables.ts --check    fails on a stale or missing table or a bad translation
 *
 * For each locale of a package's `identifiers.json` `locales`, `package.nls.<locale>.json` holds every key of
 * `package.nls.json`, and `l10n/bundle.l10n.<locale>.json` every key of `l10n/bundle.l10n.json`, in the default
 * table's order. A text is the one in `translations/<locale>.json` (`manifest` for the first, `runtime` for the
 * second) when there is one, else the English text. A package that declares `pseudoLocalized` gets its qps-ploc
 * tables generated from its English tables, letter for letter, with its locked strings kept as they are. The
 * generated tables are git-ignored.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {readDeclared} from './identifier-sources.ts';
import {pseudoLocalize} from './pseudo-locale.ts';
import {readObject} from './string-tables.ts';
import {
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
} from './repository.ts';

const NLS_SOURCE = 'package.nls.json';
const BUNDLE_SOURCE = 'l10n/bundle.l10n.json';
const TRANSLATIONS_FOLDER = 'translations';
const TRANSLATION_FILE = /^(.+)\.json$/;
const PARTS = ['manifest', 'runtime'] as const;
const QPS_PLOC = 'qps-ploc';

type Table = Record<string, string>;

/** The tables a package's generator would write, each by its path below the package, and what is wrong with the sources. */
interface Generated {
  files: Map<string, string>;
  problems: string[];
}

/** A table as Prettier writes JSON. */
function printed(table: Table): string {
  return `${JSON.stringify(table, null, 2)}\n`;
}

/** A JSON object of texts; a problem names the file when it is none. */
function readTable(directory: string, file: string, problems: string[]): Table {
  try {
    return readObject(directory, file) as Table;
  } catch (error) {
    problems.push(`${file}: cannot be read: ${messageOf(error)}`);
    return {};
  }
}

/** The translations of one locale: its file's `manifest` and `runtime` parts, each a table. */
function readTranslations(
  directory: string,
  locale: string,
  problems: string[],
): Record<(typeof PARTS)[number], Table> {
  const file = `${TRANSLATIONS_FOLDER}/${locale}.json`;
  const whole = readTable(directory, file, problems) as Record<string, unknown>;
  const tables: Record<(typeof PARTS)[number], Table> = {
    manifest: {},
    runtime: {},
  };
  for (const part of PARTS) {
    const value = whole[part];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      problems.push(`${file}: '${part}' is not a table`);
    } else {
      tables[part] = value as Table;
    }
  }
  for (const extra of Object.keys(whole).filter(
    name => !(PARTS as readonly string[]).includes(name),
  )) {
    problems.push(`${file}: '${extra}' is neither 'manifest' nor 'runtime'`);
  }
  return tables;
}

/** The texts of an English table with the locked strings of each key; a value is a string or the editor's object form. */
interface DefaultTable {
  texts: Table;
  locked: Record<string, string[]>;
}

/** The English text and the locked strings of one value of an English table. */
export function englishEntry(value: unknown): {text: string; locked: string[]} {
  if (typeof value === 'string') {
    return {text: value, locked: []};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {text: '', locked: []};
  }
  const form = value as Record<string, unknown>;
  const comments = Array.isArray(form.comment)
    ? form.comment.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    text: typeof form.message === 'string' ? form.message : '',
    locked: comments.flatMap(comment => {
      const found = /^\{Locked='(.*)'\}$/.exec(comment);
      return found === null ? [] : [found[1] ?? ''];
    }),
  };
}

/** The default table of a package, or none when the package has none or its file cannot be read. */
function defaultTable(
  directory: string,
  file: string,
  problems: string[],
): DefaultTable | undefined {
  if (!existsSync(path.join(directory, file))) {
    return undefined;
  }
  const before = problems.length;
  const whole = readTable(directory, file, problems) as Record<string, unknown>;
  if (problems.length > before) {
    return undefined;
  }
  const table: DefaultTable = {texts: {}, locked: {}};
  for (const [key, value] of Object.entries(whole)) {
    const entry = englishEntry(value);
    table.texts[key] = entry.text;
    table.locked[key] = entry.locked;
  }
  return table;
}

/** The problems of one part of a translations file against its default table. */
function translationProblems(
  file: string,
  part: string,
  translated: Table,
  source: DefaultTable | undefined,
): string[] {
  return Object.entries(translated).flatMap(([key, text]) => [
    ...(source !== undefined && key in source.texts
      ? []
      : [`${file}: '${key}' is not a key of the default ${part} table`]),
    ...(typeof text === 'string' && text.trim() !== ''
      ? []
      : [`${file}: '${key}' has no text`]),
  ]);
}

/** The locale tables of `packages/<folder>`; none for a package whose identifiers.json states no locales. */
export function generatedTables(root: string, folder: string): Generated {
  const directory = path.join(root, 'packages', folder);
  const declaredFile = path.join(directory, 'identifiers.json');
  const generated: Generated = {files: new Map(), problems: []};
  const declared = existsSync(declaredFile)
    ? readDeclared(declaredFile, `packages/${folder}/identifiers.json`)
    : undefined;
  const locales = declared?.locales;
  if (declared === undefined || locales === undefined) {
    return generated;
  }
  const pseudo = declared.pseudoLocalized === true;
  const {files, problems} = generated;
  const sources = {
    manifest: defaultTable(directory, NLS_SOURCE, problems),
    runtime: defaultTable(directory, BUNDLE_SOURCE, problems),
  };
  const folderPath = path.join(directory, TRANSLATIONS_FOLDER);
  for (const name of existsSync(folderPath) ? readdirSync(folderPath) : []) {
    const locale = TRANSLATION_FILE.exec(name)?.[1];
    if (locale === undefined || !locales.includes(locale)) {
      problems.push(
        `${TRANSLATIONS_FOLDER}/${name}: not a translations file of the package's locales`,
      );
    } else if (pseudo && locale === QPS_PLOC) {
      problems.push(
        `${TRANSLATIONS_FOLDER}/${name}: qps-ploc is generated for this package, never written`,
      );
    }
  }
  for (const locale of locales) {
    const translations = existsSync(path.join(folderPath, `${locale}.json`))
      ? readTranslations(directory, locale, problems)
      : {manifest: {}, runtime: {}};
    const targets = {
      manifest: `package.nls.${locale}.json`,
      runtime: `l10n/bundle.l10n.${locale}.json`,
    };
    for (const part of PARTS) {
      problems.push(
        ...translationProblems(
          `${TRANSLATIONS_FOLDER}/${locale}.json`,
          part,
          translations[part],
          sources[part],
        ),
      );
      const source = sources[part];
      if (source !== undefined) {
        files.set(
          targets[part],
          printed(
            Object.fromEntries(
              Object.entries(source.texts).map(([key, text]) => [
                key,
                translations[part][key] ??
                  (pseudo && locale === QPS_PLOC
                    ? pseudoLocalize(text, source.locked[key])
                    : text),
              ]),
            ),
          ),
        );
      }
    }
  }
  return generated;
}

/** The problems of every package: a source that is wrong, and a generated table that is missing or stale. */
export function localeTableProblems(root: string): string[] {
  return packageFolders(root).flatMap(folder => {
    const {files, problems} = generatedTables(root, folder);
    return [
      ...problems,
      ...[...files].flatMap(([file, content]) => {
        const where = path.join(root, 'packages', folder, file);
        if (!existsSync(where)) {
          return [`${file}: missing`];
        }
        return readFileSync(where, 'utf8') === content
          ? []
          : [`${file}: stale`];
      }),
    ].map(problem => `packages/${folder}/${problem}`);
  });
}

/** Writes every package's locale tables; throws, naming the sources, when one is wrong. */
export function writeLocaleTables(root: string): void {
  for (const folder of packageFolders(root)) {
    const {files, problems} = generatedTables(root, folder);
    if (problems.length > 0) {
      throw new Error(
        problems.map(problem => `packages/${folder}/${problem}`).join('\n'),
      );
    }
    for (const [file, content] of files) {
      const where = path.join(root, 'packages', folder, file);
      mkdirSync(path.dirname(where), {recursive: true});
      writeFileSync(where, content);
    }
  }
}

if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const problems = localeTableProblems(REPOSITORY_ROOT);
      for (const problem of problems) {
        console.error(`locale-tables: ${problem}`);
      }
      if (problems.length === 0) {
        console.log('locale-tables: ok');
      }
      process.exitCode = problems.length === 0 ? 0 : 1;
    } else {
      writeLocaleTables(REPOSITORY_ROOT);
    }
  } catch (error) {
    console.error(`locale-tables: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
