/**
 * @fileoverview check-layout: the rules of docs/architecture/layout.md and ADR-0002 that can be checked without
 * code, followed by tools/check-workspace.ts. `tools/check-layout` runs it.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {checkWorkspace} from './check-workspace.ts';
import {EDITOR_ENGINE} from './editor-floor.ts';
import {checkStringTables} from './string-tables.ts';
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

// The extensions the acceptance run installs besides the family's: they run in the same editor, so they declare the same floor.
const ACCEPTANCE_EXTENSIONS = [
  'runner',
  'runner-remote',
  'slow-remote',
  'window-agent',
];

// ADR-0002, decision 5: the last @vscode/vsce without the proprietary @vscode/vsce-sign dependency.
const VSCE_VERSION = '2.26.0';

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

interface ManifestIdentity {
  name?: string;
  publisher?: string;
  engines?: {vscode?: string};
}

function readManifest(file: string): ManifestIdentity {
  try {
    // A package.json is a JSON object; each field read here is checked where it is used.
    return JSON.parse(readFileSync(file, 'utf8')) as ManifestIdentity;
  } catch {
    // check-workspace reports a manifest that cannot be read.
    return {};
  }
}

function engineProblems(
  where: string,
  fields: ManifestIdentity,
  problems: string[],
): void {
  if (fields.engines?.vscode !== EDITOR_ENGINE) {
    problems.push(
      `${where}/package.json has engines.vscode '${fields.engines?.vscode ?? ''}', expected '${EDITOR_ENGINE}' (ADR-0007)`,
    );
  }
}

function checkAcceptanceExtensions(root: string, problems: string[]): void {
  for (const folder of ACCEPTANCE_EXTENSIONS) {
    const where = `tests/acceptance/${folder}`;
    const manifest = path.join(root, where, 'package.json');
    if (existsSync(manifest)) {
      engineProblems(where, readManifest(manifest), problems);
    }
  }
}

function checkPackageFolder(
  root: string,
  folder: string,
  references: Set<string>,
  rootLicense: string | undefined,
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
    const fields = readManifest(manifest);
    const found = fields.name ?? '';
    const expected = expectedPackageName(folder);
    if (found !== expected) {
      problems.push(
        `${where}/package.json has name '${found}', expected '${expected}'`,
      );
    }
    // A manifest with a publisher is an extension manifest; the placeholders have none yet (ADR-0007).
    if (fields.publisher !== undefined) {
      engineProblems(where, fields, problems);
    }
    if (fields.publisher !== undefined && rootLicense !== undefined) {
      const licence = path.join(directory, 'LICENSE');
      if (!existsSync(licence)) {
        problems.push(
          `${where}/LICENSE is missing (every extension ships the MIT licence)`,
        );
      } else if (readFileSync(licence, 'utf8') !== rootLicense) {
        problems.push(`${where}/LICENSE differs from the repository's LICENSE`);
      }
      const ignore = path.join(directory, '.vscodeignore');
      if (
        existsSync(ignore) &&
        !readFileSync(ignore, 'utf8').split('\n').includes('!LICENSE')
      ) {
        problems.push(
          `${where}/.vscodeignore leaves LICENSE out of the package`,
        );
      }
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

function checkPackagingTool(root: string, problems: string[]): void {
  const declared = readManifest(path.join(root, 'package.json')) as {
    devDependencies?: Record<string, string>;
  };
  const specifier = declared.devDependencies?.['@vscode/vsce'];
  const lockfile = path.join(root, 'pnpm-lock.yaml');
  const locked = existsSync(lockfile)
    ? [
        ...readFileSync(lockfile, 'utf8').matchAll(
          /^ {2}'@vscode\/vsce@([^'(]+)[^']*':$/gm,
        ),
      ].map(match => match[1])
    : [];
  if (
    specifier !== VSCE_VERSION ||
    locked.some(version => version !== VSCE_VERSION)
  ) {
    problems.push(
      `@vscode/vsce must stay exactly ${VSCE_VERSION} (ADR-0002, decision 5); package.json has '${specifier ?? ''}', the lockfile ${locked.join(', ') || 'none'}`,
    );
  }
}

function stringTableProblems(root: string, folder: string): string[] {
  try {
    return checkStringTables(root, folder).map(
      problem => `string-tables: ${problem}`,
    );
  } catch (error) {
    return [`string-tables: ${messageOf(error)}`];
  }
}

// ADR-0006: product names, server folders, download hosts and release prefixes appear in package code only in
// lib-product's product table. `codium` also covers `vscodium` and the VSCodium release prefixes;
// `code.visualstudio.com` covers its update host; `vscode-server` covers `.vscode-server`.
const PRODUCT_LITERAL =
  /codium|code\.visualstudio\.com|vscode-server|vscode\.download\.prss\.microsoft\.com/i;
const PRODUCT_TABLE = path.join(
  'packages',
  'lib-product',
  'src',
  'product-table.ts',
);

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return sortedEntries(directory).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(fullPath);
    }
    return entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function checkProductLiterals(root: string, problems: string[]): void {
  for (const folder of packageFolders(root)) {
    for (const file of sourceFiles(
      path.join(root, 'packages', folder, 'src'),
    )) {
      const relative = path.relative(root, file);
      if (
        relative !== PRODUCT_TABLE &&
        PRODUCT_LITERAL.test(readFileSync(file, 'utf8'))
      ) {
        problems.push(
          `${relative} names a product or a download host; only ${PRODUCT_TABLE} may (ADR-0006)`,
        );
      }
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
  const rootLicense = existsSync(path.join(root, 'LICENSE'))
    ? readFileSync(path.join(root, 'LICENSE'), 'utf8')
    : undefined;
  for (const folder of packageFolders(root)) {
    checkPackageFolder(root, folder, references, rootLicense, problems);
    if (existsSync(path.join(root, 'packages', folder, 'package.json'))) {
      problems.push(...stringTableProblems(root, folder));
    }
  }
  checkAcceptanceExtensions(root, problems);
  checkDecisionRecords(root, problems);
  checkPackagingTool(root, problems);
  checkProductLiterals(root, problems);
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
