/**
 * @fileoverview public-surface: the CI check that no file a user can read carries wording of the process (ADR-0008,
 * decision 5). It reads each package's README, changelog, manifest, string tables, localisation bundles, grammars and
 * language configuration, and the user documentation under docs/<extension>/. Source comments are checked by the
 * `comments/public-surface` lint rule with the same term list.
 *
 *     node tools/public-surface.ts
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {forbiddenMatches} from './public-surface-terms.ts';
import {
  isMainModule,
  packageFolders,
  REPOSITORY_ROOT,
  sortedEntries,
} from './repository.ts';

/** The files of a package that ship or describe it, by name. */
const PACKAGE_FILES =
  /^(README.*|CHANGELOG.*|package(\.nls.*)?\.json|language-configuration\.json)$/;

/** The folders of a package whose files all ship. */
const PACKAGE_FOLDERS = ['l10n', 'syntaxes'];

/** Third-party texts keep their own words (ADR-0008, decision 5). */
const THIRD_PARTY_FILE = /^(LICENSE|ThirdPartyNotices)/;

/** The folders under docs/ that are working documents and leave before publication (ADR-0008, decision 4). */
const PRIVATE_DOCS = new Set(['architecture', 'adr']);

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return sortedEntries(directory).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(full) : [full];
  });
}

/** The shipped and user-facing files under `root`, as paths relative to it. */
function surfaceFiles(root: string): string[] {
  const absolute: string[] = [];
  if (existsSync(path.join(root, 'CONTRIBUTING.md'))) {
    absolute.push(path.join(root, 'CONTRIBUTING.md'));
  }
  absolute.push(...filesBelow(path.join(root, '.github')));
  for (const folder of packageFolders(root)) {
    const directory = path.join(root, 'packages', folder);
    absolute.push(
      ...sortedEntries(directory)
        .filter(entry => entry.isFile() && PACKAGE_FILES.test(entry.name))
        .map(entry => path.join(directory, entry.name)),
      ...PACKAGE_FOLDERS.flatMap(name =>
        filesBelow(path.join(directory, name)),
      ),
    );
  }
  const docs = path.join(root, 'docs');
  if (existsSync(docs)) {
    for (const entry of sortedEntries(docs)) {
      if (entry.isDirectory() && !PRIVATE_DOCS.has(entry.name)) {
        absolute.push(...filesBelow(path.join(docs, entry.name)));
      }
    }
  }
  return absolute
    .filter(file => !THIRD_PARTY_FILE.test(path.basename(file)))
    .map(file => path.relative(root, file));
}

/** One line per forbidden word or phrase in the shipped and user-facing files under `root`. */
export function checkPublicSurface(root: string): string[] {
  const problems: string[] = [];
  for (const file of surfaceFiles(root)) {
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const match of forbiddenMatches(text)) {
      const line = text.slice(0, match.index).split('\n').length;
      problems.push(
        `${file}:${String(line)}: '${match.term}' is wording of the process; shipped text presents the product (ADR-0008)`,
      );
    }
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  const problems = checkPublicSurface(REPOSITORY_ROOT);
  for (const problem of problems) {
    console.error(`public-surface: ${problem}`);
  }
  if (problems.length === 0) {
    console.log('public-surface: ok');
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
