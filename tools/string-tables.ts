/**
 * @fileoverview string-tables: the build check of a package's string tables (contracts §1.2).
 *
 *     node tools/string-tables.ts                  every package in packages/
 *     node tools/string-tables.ts remote-ssh ...   the named package folders
 *
 * Every `%key%` of package.json has a text in package.nls.json. Each locale has package.nls.<locale>.json with
 * exactly the keys of package.nls.json. When l10n/ exists, each locale has l10n/bundle.l10n.<locale>.json with
 * exactly the keys of the default bundle l10n/bundle.l10n.json; the folder holds nothing else. Every string the package's code
 * translates (see translated-strings.ts) is a key of the default bundle, and every key of the default bundle is
 * translated by the package's own code or by a workspace library in its dependency closure. Every text is a non-empty
 * string. The locales are identifiers.json's `locales`, or the locales of the tables present when it names none.
 */

import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {readPackageSources} from './identifier-sources.ts';
import {translatedStrings} from './translated-strings.ts';
import {
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
} from './repository.ts';

/** A problem in one file, the path relative to the package folder. */
interface FileProblem {
  file: string;
  text: string;
}

type StringTable = Map<string, unknown>;

const NLS_SOURCE = 'package.nls.json';
const NLS_PATTERN = /^package\.nls\.(.+)\.json$/;
const BUNDLE_FOLDER = 'l10n';
const BUNDLE_PATTERN = /^bundle\.l10n\.(.+)\.json$/;
const BUNDLE_SOURCE = `${BUNDLE_FOLDER}/bundle.l10n.json`;

function nlsFile(locale: string): string {
  return `package.nls.${locale}.json`;
}

function bundleFile(locale: string): string {
  return `${BUNDLE_FOLDER}/bundle.l10n.${locale}.json`;
}

/** The JSON object in `directory/file`; throws when the file holds anything else. */
export function readObject(
  directory: string,
  file: string,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(directory, file), 'utf8'),
  );
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Reads a table, or records why it cannot be read and returns undefined. */
function readTable(
  directory: string,
  file: string,
  problems: FileProblem[],
): StringTable | undefined {
  try {
    return new Map(Object.entries(readObject(directory, file)));
  } catch (error) {
    problems.push({file, text: `cannot be read: ${messageOf(error)}`});
    return undefined;
  }
}

function emptyTextProblems(file: string, table: StringTable): FileProblem[] {
  return [...table]
    .filter(([, text]) => typeof text !== 'string' || text.trim() === '')
    .map(([textKey]) => ({file, text: `key '${textKey}' has no text`}));
}

function parityProblems(
  file: string,
  table: StringTable,
  expected: ReadonlySet<string>,
): FileProblem[] {
  return [
    ...[...expected]
      .filter(textKey => !table.has(textKey))
      .map(textKey => ({file, text: `missing key '${textKey}'`})),
    ...[...table.keys()]
      .filter(textKey => !expected.has(textKey))
      .map(textKey => ({file, text: `extra key '${textKey}'`})),
  ];
}

function localesOf(files: readonly string[], pattern: RegExp): string[] {
  return files.flatMap(file => {
    const locale = pattern.exec(file)?.[1];
    return locale === undefined ? [] : [locale];
  });
}

/** Reads the tables that exist and are readable; records each missing or unreadable file. */
function readTables(
  directory: string,
  files: readonly string[],
  problems: FileProblem[],
): Map<string, StringTable> {
  const tables = new Map<string, StringTable>();
  for (const file of files) {
    if (!existsSync(path.join(directory, file))) {
      problems.push({file, text: 'missing'});
      continue;
    }
    const table = readTable(directory, file, problems);
    if (table !== undefined) {
      tables.set(file, table);
    }
  }
  return tables;
}

function translationProblems(
  tables: ReadonlyMap<string, StringTable>,
  keys: ReadonlySet<string>,
): FileProblem[] {
  return [...tables].flatMap(([file, table]) => [
    ...parityProblems(file, table, keys),
    ...emptyTextProblems(file, table),
  ]);
}

function nlsProblems(
  directory: string,
  references: readonly string[],
  locales: readonly string[],
  problems: FileProblem[],
): void {
  if (!existsSync(path.join(directory, NLS_SOURCE))) {
    for (const textKey of references) {
      problems.push({
        file: 'package.json',
        text: `'%${textKey}%' has no ${NLS_SOURCE}`,
      });
    }
    return;
  }
  const source = readTable(directory, NLS_SOURCE, problems);
  if (source === undefined) {
    return;
  }
  problems.push(...emptyTextProblems(NLS_SOURCE, source));
  for (const textKey of references.filter(
    reference => !source.has(reference),
  )) {
    problems.push({
      file: 'package.json',
      text: `'%${textKey}%' is not in ${NLS_SOURCE}`,
    });
  }
  problems.push(
    ...translationProblems(
      readTables(directory, locales.map(nlsFile), problems),
      new Set(source.keys()),
    ),
  );
}

/** The source files of a package that ship: the TypeScript files under src, without tests, fixtures and test doubles. */
function shippedSources(directory: string, relative = 'src'): string[] {
  const folder = path.join(directory, relative);
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : shippedSources(directory, child);
    }
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.fixture.ts')
      ? [child]
      : [];
  });
}

/** A problem for each string the package's code translates that the default bundle has no key for. */
function untranslatedProblems(
  directory: string,
  keys: ReadonlySet<string>,
): FileProblem[] {
  return shippedSources(directory).flatMap(file =>
    translatedStrings(file, readFileSync(path.join(directory, file), 'utf8'))
      .filter(found => !keys.has(found.text))
      .map(found => ({
        file: `${file}:${String(found.line)}`,
        text: `"${found.text}" is translated but not a key of ${BUNDLE_SOURCE}`,
      })),
  );
}

/**
 * The package folders whose code runs in `folder`'s l10n context: the folder itself and every workspace library it
 * depends on, directly or through another library.
 */
function closureFolders(root: string, folder: string): string[] {
  const seen = new Set<string>([folder]);
  const queue = [folder];
  for (const current of queue) {
    const manifest = path.join(root, 'packages', current, 'package.json');
    if (!existsSync(manifest)) {
      continue;
    }
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const name of Object.keys(parsed.dependencies ?? {})) {
      if (
        !seen.has(name) &&
        existsSync(path.join(root, 'packages', name, 'package.json'))
      ) {
        seen.add(name);
        queue.push(name);
      }
    }
  }
  return [...seen];
}

/** A problem for each key of the default bundle that no code of the package or of its libraries translates. */
function unusedKeyProblems(
  root: string,
  folder: string,
  keys: ReadonlySet<string>,
): FileProblem[] {
  const directory = path.join(root, 'packages', folder);
  if (shippedSources(directory).length === 0) {
    return [];
  }
  const translated = new Set(
    closureFolders(root, folder).flatMap(member => {
      const memberDirectory = path.join(root, 'packages', member);
      return shippedSources(memberDirectory).flatMap(file =>
        translatedStrings(
          file,
          readFileSync(path.join(memberDirectory, file), 'utf8'),
        ).map(found => found.text),
      );
    }),
  );
  return [...keys]
    .filter(key => !translated.has(key))
    .map(key => ({
      file: BUNDLE_SOURCE,
      text: `"${key}" is never translated`,
    }));
}

function bundleProblems(
  root: string,
  folder: string,
  locales: readonly string[],
  problems: FileProblem[],
): void {
  const directory = path.join(root, 'packages', folder);
  const bundles = path.join(directory, BUNDLE_FOLDER);
  if (!existsSync(bundles)) {
    return;
  }
  const translatedFiles = locales.map(bundleFile);
  const knownFiles = new Set([BUNDLE_SOURCE, ...translatedFiles]);
  for (const name of readdirSync(bundles)) {
    const file = `${BUNDLE_FOLDER}/${name}`;
    if (!knownFiles.has(file)) {
      problems.push({file, text: "not a bundle of the package's locales"});
    }
  }
  const source = existsSync(path.join(directory, BUNDLE_SOURCE))
    ? readTable(directory, BUNDLE_SOURCE, problems)
    : undefined;
  if (source === undefined) {
    if (!existsSync(path.join(directory, BUNDLE_SOURCE))) {
      problems.push({file: BUNDLE_SOURCE, text: 'missing'});
    }
    return;
  }
  problems.push(...emptyTextProblems(BUNDLE_SOURCE, source));
  const sourceKeys = new Set(source.keys());
  problems.push(...untranslatedProblems(directory, sourceKeys));
  problems.push(...unusedKeyProblems(root, folder, sourceKeys));
  problems.push(
    ...translationProblems(
      readTables(directory, translatedFiles, problems),
      sourceKeys,
    ),
  );
}

/**
 * The string-table problems of `packages/<folder>`, each as `packages/<folder>/<file>: <problem>`, ordered by
 * file; an empty list means the tables pass.
 */
export function checkStringTables(root: string, folder: string): string[] {
  const directory = path.join(root, 'packages', folder);
  const problems: FileProblem[] = [];
  const sources = readPackageSources(root, folder);
  const declared = sources.declared?.locales;
  const bundleFolder = path.join(directory, BUNDLE_FOLDER);
  const locales = declared ?? [
    ...new Set([
      ...localesOf(readdirSync(directory), NLS_PATTERN),
      ...(existsSync(bundleFolder)
        ? localesOf(readdirSync(bundleFolder), BUNDLE_PATTERN)
        : []),
    ]),
  ];
  if (declared !== undefined) {
    for (const locale of localesOf(readdirSync(directory), NLS_PATTERN)) {
      if (!declared.includes(locale)) {
        problems.push({
          file: nlsFile(locale),
          text: "not a table of the package's locales",
        });
      }
    }
  }
  nlsProblems(directory, sources.manifest.stringReferences, locales, problems);
  bundleProblems(root, folder, locales, problems);
  return problems
    .map((problem, position) => ({...problem, position}))
    .sort((left, right) =>
      left.file === right.file
        ? left.position - right.position
        : left.file < right.file
          ? -1
          : 1,
    )
    .map(problem => `packages/${folder}/${problem.file}: ${problem.text}`);
}

if (isMainModule(import.meta.url)) {
  try {
    const folders = process.argv.slice(2);
    const problems = (
      folders.length > 0 ? folders : packageFolders(REPOSITORY_ROOT)
    ).flatMap(folder => checkStringTables(REPOSITORY_ROOT, folder));
    for (const problem of problems) {
      console.error(`string-tables: ${problem}`);
    }
    if (problems.length === 0) {
      console.log('string-tables: ok');
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`string-tables: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
