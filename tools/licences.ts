/**
 * @fileoverview licences: checks the licence of every installed dependency against the allowlist of ADR-0002,
 * decision 8 (licences compatible with MIT).
 *
 *     node tools/licences.ts
 *
 * A package passes when its SPDX expression is allowed (an OR passes when one branch is allowed, an AND when every
 * part is) or when it has a named exception. A package without a licence, or `UNLICENSED`, always fails, and so
 * does an excepted package that appears among the runtime dependencies. A failure names the dependency chain
 * through which the package is installed.
 */

import {spawnSync} from 'node:child_process';
import {isMainModule, messageOf, REPOSITORY_ROOT} from './repository.ts';

/** The licences any dependency may carry, each with a note where its presence is not obvious. */
const ALLOWED_LICENCES = new Map<string, string>([
  ['MIT', ''],
  ['ISC', ''],
  ['Apache-2.0', ''],
  ['BSD-2-Clause', ''],
  ['BSD-3-Clause', ''],
  ['0BSD', ''],
  ['CC0-1.0', ''],
  ['Zlib', 'permissive'],
  ['Python-2.0', 'argparse'],
  ['BlueOak-1.0.0', 'permissive, not listed by the OSI'],
]);

/** Packages allowed despite their licence, each with the reason; an exception holds only for a dev dependency. */
const PACKAGE_EXCEPTIONS = new Map<string, string>([
  [
    'spdx-exceptions',
    'CC-BY-3.0: an SPDX data file, dev-only, with an attribution duty only',
  ],
]);

const MISSING_LICENCES = new Set(['', 'Unknown', 'UNLICENSED']);

/** One package as `pnpm licenses list --json` reports it. */
export interface LicensedPackage {
  name: string;
  versions: string[];
}

/** One step of the reverse dependency tree that `pnpm why --json` reports. */
export interface DependentNode {
  name: string;
  version?: string;
  depField?: string;
  dependents?: DependentNode[];
}

/** Runs pnpm with the arguments from the repository root and returns its standard output. */
export type PnpmRunner = (pnpmArguments: string[]) => string;

function splitTopLevel(expression: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const word of expression.split(/\s+/)) {
    depth += (word.match(/\(/g) ?? []).length;
    depth -= (word.match(/\)/g) ?? []).length;
    if (word === operator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ` ${word}`;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** The index of the parenthesis that closes the one at index 0, or -1. */
function closingParenthesis(expression: string): number {
  let depth = 0;
  for (let position = 0; position < expression.length; position++) {
    const character = expression.charAt(position);
    depth += character === '(' ? 1 : character === ')' ? -1 : 0;
    if (depth === 0) {
      return position;
    }
  }
  return -1;
}

function withoutOuterParentheses(expression: string): string {
  let inner = expression.trim();
  while (
    inner.startsWith('(') &&
    closingParenthesis(inner) === inner.length - 1
  ) {
    inner = inner.slice(1, -1).trim();
  }
  return inner;
}

/** Whether an SPDX expression is allowed: OR needs one allowed branch, AND needs every part allowed. */
export function isAllowedExpression(expression: string): boolean {
  const inner = withoutOuterParentheses(expression);
  const branches = splitTopLevel(inner, 'OR');
  if (branches.length > 1) {
    return branches.some(isAllowedExpression);
  }
  const parts = splitTopLevel(inner, 'AND');
  if (parts.length > 1) {
    return parts.every(isAllowedExpression);
  }
  return ALLOWED_LICENCES.has(inner);
}

/** The first chain from `node` to a root package: `name@version <- dependent@version <- root (field)`. */
export function dependencyChain(node: DependentNode): string {
  const label =
    node.version === undefined ? node.name : `${node.name}@${node.version}`;
  const parent = node.dependents?.[0];
  if (parent !== undefined) {
    return `${label} <- ${dependencyChain(parent)}`;
  }
  return node.depField === undefined ? label : `${label} (${node.depField})`;
}

/** Runs pnpm from the repository root and returns its standard output; throws when pnpm fails. */
export function runPnpm(pnpmArguments: string[]): string {
  const result = spawnSync('pnpm', pnpmArguments, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${pnpmArguments.join(' ')} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function listLicences(
  runner: PnpmRunner,
  extra: string[],
): Map<string, LicensedPackage[]> {
  // `pnpm licenses list --json` maps each licence expression to the packages that carry it.
  const listing = JSON.parse(
    runner(['licenses', 'list', '--json', ...extra]) || '{}',
  ) as Record<string, LicensedPackage[]>;
  return new Map(Object.entries(listing));
}

function chainOf(runner: PnpmRunner, name: string): string {
  // `pnpm why --json` returns one reverse dependency tree per installed version.
  const trees = JSON.parse(runner(['why', name, '--json']) || '[]') as
    DependentNode[] | undefined;
  const tree = trees?.[0];
  return tree === undefined ? name : dependencyChain(tree);
}

/**
 * The licence problems of the installed tree, each naming the package and the chain through which it is
 * installed; an empty list means every dependency passes.
 */
export function checkLicences(runner: PnpmRunner = runPnpm): string[] {
  const problems: string[] = [];
  const runtimeNames = new Set(
    [...listLicences(runner, ['--prod']).values()].flatMap(packages =>
      packages.map(entry => entry.name),
    ),
  );
  for (const [licence, packages] of listLicences(runner, [])) {
    for (const entry of packages) {
      const label = `${entry.name}@${entry.versions.join(',')}`;
      let reason: string | undefined;
      if (MISSING_LICENCES.has(licence.trim())) {
        reason = `has no licence ('${licence}')`;
      } else if (PACKAGE_EXCEPTIONS.has(entry.name)) {
        reason = runtimeNames.has(entry.name)
          ? `is excepted for dev use only (${licence}) but is a runtime dependency`
          : undefined;
      } else if (!isAllowedExpression(licence)) {
        reason = `has licence '${licence}', which is not on the allowlist`;
      }
      if (reason !== undefined) {
        problems.push(
          `${label} ${reason}; installed through ${chainOf(runner, entry.name)}`,
        );
      }
    }
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  try {
    const problems = checkLicences();
    for (const problem of problems) {
      console.error(`licences: ${problem}`);
    }
    if (problems.length === 0) {
      console.log('licences: ok');
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`licences: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
