/**
 * @fileoverview identifiers: writes each package's generated identifier table and runs the CI check
 * `identifiers` (ADR draft "Identifier tables", decisions 2 and 5).
 *
 *     node tools/identifiers.ts           write packages/<x>/src/identifiers.generated.ts
 *     node tools/identifiers.ts --check   check the sources of every package
 *
 * A package with a src/ folder must have identifiers.json and gets a table; one whose kinds are all empty gets
 * none. The check applies the rules of tools/identifier-rules.ts to every package with identifiers.json. The
 * comparison with the rooms' reference inventories is reported as skipped until the rooms publish them.
 */

import {rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {format, resolveConfig} from 'prettier';
import {checkPackageRules} from './identifier-rules.ts';
import {
  DECLARED_FILE,
  hasSources,
  readPackageSources,
  type PackageSources,
} from './identifier-sources.ts';
import {TABLE_FILE, tableSource} from './identifier-table.ts';
import {
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
} from './repository.ts';

/** The check's result over the repository. */
export interface IdentifierReport {
  problems: string[];
  notes: string[];
}

const INVENTORY_NOTE =
  'reference inventory comparison skipped: the rooms have not published their inventories';

const MISSING_DECLARED = `${DECLARED_FILE} is missing; a package with src/ needs one`;

/** The sources of a package with code; throws when its identifiers.json is missing. */
function sourcesWithDeclared(root: string, folder: string): PackageSources {
  const {manifest, declared} = readPackageSources(root, folder);
  if (declared === undefined) {
    throw new Error(MISSING_DECLARED);
  }
  return {folder, manifest, declared};
}

async function formattedTable(file: string, source: string): Promise<string> {
  const settings = await resolveConfig(file, {
    config: path.join(REPOSITORY_ROOT, 'prettier.config.ts'),
  });
  return format(source, {...settings, filepath: file});
}

/**
 * Writes the table of every package with src/ under `<root>/packages`, removes a table whose kinds are now all
 * empty, and returns one line per package with src/. Throws on the first package whose sources cannot be read.
 */
export async function generateTables(root: string): Promise<string[]> {
  const outcomes: string[] = [];
  for (const folder of packageFolders(root)) {
    const directory = path.join(root, 'packages', folder);
    if (!hasSources(directory)) {
      continue;
    }
    let source: string | undefined;
    try {
      source = tableSource(sourcesWithDeclared(root, folder));
    } catch (error) {
      throw new Error(`packages/${folder}: ${messageOf(error)}`, {
        cause: error,
      });
    }
    const file = path.join(directory, TABLE_FILE);
    if (source === undefined) {
      rmSync(file, {force: true});
      outcomes.push(`${folder}: no identifiers, no table`);
    } else {
      writeFileSync(file, await formattedTable(file, source));
      outcomes.push(`${folder}: ${TABLE_FILE}`);
    }
  }
  return outcomes;
}

/** Checks the identifier sources of every package under `<root>/packages`. */
export function checkIdentifiers(root: string): IdentifierReport {
  const problems: string[] = [];
  const notes: string[] = [INVENTORY_NOTE];
  for (const folder of packageFolders(root)) {
    try {
      const {manifest, declared} = readPackageSources(root, folder);
      if (declared === undefined) {
        if (hasSources(path.join(root, 'packages', folder))) {
          problems.push(`packages/${folder}: ${MISSING_DECLARED}`);
        }
        continue;
      }
      const outcome = checkPackageRules({folder, manifest, declared});
      problems.push(
        ...outcome.problems.map(text => `packages/${folder}: ${text}`),
      );
      notes.push(...outcome.notes.map(text => `packages/${folder}: ${text}`));
    } catch (error) {
      problems.push(`packages/${folder}: ${messageOf(error)}`);
    }
  }
  return {problems, notes};
}

if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const report = checkIdentifiers(REPOSITORY_ROOT);
      for (const note of report.notes) {
        console.log(`identifiers: ${note}`);
      }
      for (const problem of report.problems) {
        console.error(`identifiers: ${problem}`);
      }
      if (report.problems.length === 0) {
        console.log('identifiers: ok');
      }
      process.exitCode = report.problems.length === 0 ? 0 : 1;
    } else {
      for (const outcome of await generateTables(REPOSITORY_ROOT)) {
        console.log(`identifiers: ${outcome}`);
      }
    }
  } catch (error) {
    console.error(`identifiers: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
