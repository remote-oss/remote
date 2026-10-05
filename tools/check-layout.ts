/**
 * @fileoverview check-layout: the rules of docs/architecture/layout.md and ADR-0002 that can be checked without
 * code, followed by tools/check-workspace.ts. `tools/check-layout` runs it.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {checkWorkspace} from './check-workspace.ts';
import {
  EXTENSION_FOLDERS,
  expectedPackageName,
  isLibraryFolder,
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
  sortedEntries,
} from './repository.ts';

const REQUIRED_FILES = [
  'AGENTS.md',
  'LICENSE',
  'docs/architecture/layout.md',
  'tests/conformance/README.md',
];

const PACKAGE_TSCONFIGS = ['tsconfig.json', 'tsconfig.test.json'];

function rootReferences(root: string, problems: string[]): Set<string> {
  try {
    // The root tsconfig.json is a JSON object; a missing or malformed `references` list leaves the set empty.
    const solution = JSON.parse(
      readFileSync(path.join(root, 'tsconfig.json'), 'utf8'),
    ) as {references?: Array<{path?: string}>};
    return new Set(
      (solution.references ?? []).map(reference => reference.path ?? ''),
    );
  } catch (error) {
    problems.push(`tsconfig.json: cannot be read: ${messageOf(error)}`);
    return new Set();
  }
}

function packageName(file: string): string {
  try {
    // A package.json is a JSON object; a missing `name` reads as the empty string.
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {name?: string};
    return manifest.name ?? '';
  } catch {
    // check-workspace reports a manifest that cannot be read.
    return '';
  }
}

function checkPackageFolder(
  root: string,
  folder: string,
  references: Set<string>,
  problems: string[],
): void {
  const where = `packages/${folder}`;
  const directory = path.join(root, where);
  if (
    !isLibraryFolder(folder) &&
    !(EXTENSION_FOLDERS as readonly string[]).includes(folder)
  ) {
    problems.push(`${where} is neither an extension nor a lib-<name> folder`);
  }
  if (!existsSync(path.join(directory, 'README.md'))) {
    problems.push(`${where}/README.md is missing`);
  }
  const manifest = path.join(directory, 'package.json');
  if (existsSync(manifest)) {
    const found = packageName(manifest);
    const expected = expectedPackageName(folder);
    if (found !== expected) {
      problems.push(
        `${where}/package.json has name '${found}', expected '${expected}'`,
      );
    }
  } else {
    problems.push(
      `${where}/package.json is missing (every package folder is a workspace)`,
    );
  }
  for (const tsconfig of PACKAGE_TSCONFIGS) {
    if (!existsSync(path.join(directory, tsconfig))) {
      problems.push(`${where}/${tsconfig} is missing`);
    }
  }
  for (const reference of [where, `${where}/tsconfig.test.json`]) {
    if (!references.has(reference)) {
      problems.push(`tsconfig.json has no reference to ${reference}`);
    }
  }
}

function checkDecisionRecords(root: string, problems: string[]): void {
  const records = sortedEntries(path.join(root, 'docs', 'adr'))
    .map(entry => entry.name)
    .filter(name => name.endsWith('.md'));
  const numbers = new Map<string, number>();
  for (const name of records) {
    if (name !== 'README.md' && !/^\d{4}-[a-z0-9-]+\.md$/.test(name)) {
      problems.push(`docs/adr/${name} is not NNNN-title.md`);
    }
    const number = /^(\d{4})/.exec(name)?.[1];
    if (number !== undefined) {
      numbers.set(number, (numbers.get(number) ?? 0) + 1);
    }
  }
  const reused = [...numbers].filter(([, count]) => count > 1);
  if (reused.length > 0) {
    problems.push(
      `ADR numbers used twice: ${reused.map(([number]) => number).join(', ')}`,
    );
  }
}

/** The layout problems of the repository at `root`, the workspace problems of check-workspace included. */
export function checkLayout(root: string): string[] {
  const problems: string[] = [];
  for (const folder of EXTENSION_FOLDERS) {
    if (!existsSync(path.join(root, 'packages', folder))) {
      problems.push(`packages/${folder} is missing`);
    }
  }
  const references = rootReferences(root, problems);
  for (const folder of packageFolders(root)) {
    checkPackageFolder(root, folder, references, problems);
  }
  checkDecisionRecords(root, problems);
  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(root, file))) {
      problems.push(`${file} is missing`);
    }
  }
  return [
    ...problems,
    ...checkWorkspace(root).map(problem => `check-workspace: ${problem}`),
  ];
}

if (isMainModule(import.meta.url)) {
  const problems = checkLayout(REPOSITORY_ROOT);
  for (const problem of problems) {
    console.error(`check-layout: ${problem}`);
  }
  if (problems.length === 0) {
    console.log('check-layout: ok');
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
