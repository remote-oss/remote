/**
 * @fileoverview identifiers: writes each package's generated identifier table and runs the CI check
 * `identifiers` (ADR draft "Identifier tables", decisions 2 and 5).
 *
 *     node tools/identifiers.ts                    write packages/<x>/src/identifiers.generated.ts
 *     node tools/identifiers.ts --check             check the sources of every package
 *     node tools/identifiers.ts --consumed          check what production source consumes
 *     node tools/identifiers.ts --consumed --release   the tag run: the allowlist must be wired
 *
 * An extension package with a src/ folder must have identifiers.json and gets a table; one whose kinds are all
 * empty gets none. Libraries have neither. The check applies the rules of tools/identifier-rules.ts to every package
 * with identifiers.json. The comparison with the published identifier inventories is reported as skipped until they
 * exist.
 */

import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {format, resolveConfig} from 'prettier';
import {checkPackageRules} from './identifier-rules.ts';
import {
  DECLARED_FILE,
  needsIdentifiers,
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
import {
  checkConsumption,
  parseAllowlist,
  type AllowlistEntry,
} from './identifier-consumption.ts';

/** The check's result over the repository. */
export interface IdentifierReport {
  problems: string[];
  notes: string[];
}

const INVENTORY_NOTE =
  'reference inventory comparison skipped: no spec repository publishes tests/conformance/identity-inventory.json yet';

const MISSING_DECLARED = `${DECLARED_FILE} is missing; an extension with src/ needs one`;

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
 * Writes the table of every extension package with src/ under `<root>/packages`, removes a table whose kinds are now all
 * empty, and returns one line per such package. Throws on the first package whose sources cannot be read.
 */
export async function generateTables(root: string): Promise<string[]> {
  const outcomes: string[] = [];
  for (const folder of packageFolders(root)) {
    const directory = path.join(root, 'packages', folder);
    if (!needsIdentifiers(directory)) {
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
        if (needsIdentifiers(path.join(root, 'packages', folder))) {
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

const ALLOWLIST_FILE = 'tools/unconsumed-allowlist.json';

/**
 * The --consumed mode: reads the allowlist of `root`, runs the check, prints the report, and sets the exit code: 2
 * when the allowlist can't be read or a program can't be built, 1 with problem lines, 0 otherwise.
 */
export async function runConsumptionCheck(
  release: boolean,
  root: string = REPOSITORY_ROOT,
  runKnip?: (packageRoot: string) => Promise<string>,
): Promise<void> {
  let allowlist: readonly AllowlistEntry[];
  try {
    const text = readFileSync(path.join(root, ALLOWLIST_FILE), 'utf8');
    allowlist = parseAllowlist(text);
  } catch (error) {
    console.error(`identifiers: ${messageOf(error)}`);
    process.exitCode = 2;
    return;
  }
  try {
    const report = await checkConsumption(root, allowlist, {release, runKnip});
    if (report.fatal !== undefined) {
      console.error(`identifiers: ${report.fatal}`);
      process.exitCode = 2;
      return;
    }
    for (const problem of report.problems) {
      console.error(`identifiers: ${problem}`);
    }
    for (const note of report.notes) {
      console.log(`identifiers: note: ${note}`);
    }
    if (report.problems.length === 0) {
      console.log('identifiers: consumed: ok');
    }
    process.exitCode = report.problems.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`identifiers: ${messageOf(error)}`);
    process.exitCode = 2;
  }
}

if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.includes('--consumed')) {
      await runConsumptionCheck(process.argv.includes('--release'));
    } else if (process.argv.includes('--check')) {
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
