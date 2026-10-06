/**
 * @fileoverview string-tables: the build check of a package's string tables (contracts §1.2; F-0103, F-2002,
 * F-4003, F-5001).
 *
 *     node tools/string-tables.ts                  every package in packages/
 *     node tools/string-tables.ts remote-ssh ...   the named package folders
 *
 * Every `%key%` of package.json has a text in package.nls.json. Each locale has package.nls.<locale>.json with
 * exactly the keys of package.nls.json. When l10n/ exists, each locale has l10n/bundle.l10n.<locale>.json with
 * exactly the keys of the default bundle l10n/bundle.l10n.json, or, in a package that ships no default bundle
 * (F-4003 AC-8), the same keys as every other locale's bundle; the folder holds nothing else. Every text is a non-empty string. The locales are
 * identifiers.json's `locales`, or the locales of the tables present when it names none.
 */

import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {readPackageSources} from './identifier-sources.ts';
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

/** Reads a table, or records why it cannot be read and returns undefined. */
function readTable(
  directory: string,
  file: string,
  problems: FileProblem[],
): StringTable | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(directory, file), 'utf8'),
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('not a JSON object');
    }
    return new Map(Object.entries(parsed));
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

function bundleProblems(
  directory: string,
  locales: readonly string[],
  problems: FileProblem[],
): void {
  const folder = path.join(directory, BUNDLE_FOLDER);
  if (!existsSync(folder)) {
    return;
  }
  const translatedFiles = locales.map(bundleFile);
  const knownFiles = new Set([BUNDLE_SOURCE, ...translatedFiles]);
  for (const name of readdirSync(folder)) {
    const file = `${BUNDLE_FOLDER}/${name}`;
    if (!knownFiles.has(file)) {
      problems.push({file, text: "not a bundle of the package's locales"});
    }
  }
  let sourceKeys: Set<string> | undefined;
  if (existsSync(path.join(directory, BUNDLE_SOURCE))) {
    const source = readTable(directory, BUNDLE_SOURCE, problems);
    if (source === undefined) {
      return;
    }
    problems.push(...emptyTextProblems(BUNDLE_SOURCE, source));
    sourceKeys = new Set(source.keys());
  }
  const bundles = readTables(directory, translatedFiles, problems);
  problems.push(
    ...translationProblems(
      bundles,
      sourceKeys ??
        new Set([...bundles.values()].flatMap(table => [...table.keys()])),
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
  bundleProblems(directory, locales, problems);
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
