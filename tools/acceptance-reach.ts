/**
 * @fileoverview acceptance-reach: what a change to the launch table or to a suite's own helper reaches, measured from
 * the files rather than assumed. A change to tools/acceptance-launches.ts reaches the launches whose entries differ
 * between the base and the head; a helper in a suite folder that only that suite's tests import stands for those tests.
 * Anything the measurement cannot account for reaches every launch, as before.
 */

import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Launch} from './acceptance-launches.ts';

/** The launch table's file, as a changed path names it. */
export const LAUNCH_TABLE = 'tools/acceptance-launches.ts';

/** The launch table's functions the reach reads, each launch's view of which its fingerprint holds. */
export interface TableModule {
  launchesOf: (root: string) => Launch[];
  launchGroupOf: (launch: Launch) => string;
  settingsOfLaunch: (launch: Launch) => unknown;
  needsDevContainerImage: (launch: Launch) => boolean;
  [name: string]: unknown;
}

/** The exports a launch's fingerprint covers, so that the rest of the module is compared as it is. */
const PER_LAUNCH = [
  'launchesOf',
  'launchGroupOf',
  'settingsOfLaunch',
  'needsDevContainerImage',
];

/** A value as text holds it: a function as its source, a map as its entries. */
function heldAsText(...entry: [string, unknown]): unknown {
  const held = entry[1];
  if (typeof held === 'function') {
    return `function ${String(held)}`;
  }
  return held instanceof Map ? [...(held as Map<unknown, unknown>)] : held;
}

/** The text of a value: functions as their source, maps as their entries. */
function textOf(value: unknown): string {
  return JSON.stringify(value, heldAsText);
}

/** Each launch's fingerprint by label: its entry, its group, its settings and whether it needs the dev container image. */
function fingerprintsOf(
  table: TableModule,
  root: string,
): Map<string, string> {
  return new Map(
    table
      .launchesOf(root)
      .map(launch => [
        launch.label,
        textOf([
          launch,
          table.launchGroupOf(launch),
          table.settingsOfLaunch(launch),
          table.needsDevContainerImage(launch),
        ]),
      ]),
  );
}

/** The module's other exports, as text. */
function restOf(table: TableModule): string {
  return textOf(
    Object.keys(table)
      .filter(name => !PER_LAUNCH.includes(name))
      .sort()
      .map(name => [name, table[name]]),
  );
}

/**
 * The labels whose launches differ between two tables, added ones included: undefined when anything else the module
 * exports differs, since a launch could then change through it.
 */
export function changedLabels(
  before: TableModule,
  after: TableModule,
  root: string,
): string[] | undefined {
  if (restOf(before) !== restOf(after)) {
    return undefined;
  }
  const earlier = fingerprintsOf(before, root);
  return [...fingerprintsOf(after, root)]
    .filter(([label, print]) => earlier.get(label) !== print)
    .map(([label]) => label);
}

/**
 * The labels whose launches a change to the launch table reaches: the table at `commit` (the commit unpacked in a
 * folder of its own beside a link to the repository's node_modules, and imported) against `after`, both read over
 * `root`. Undefined when the older table cannot be read or anything else it exports differs.
 */
export async function labelsChangedSince(
  commit: string,
  after: TableModule,
  root: string,
): Promise<string[] | undefined> {
  const folder = mkdtempSync(path.join(tmpdir(), 'launch-table-'));
  try {
    const archive = spawnSync('git', ['archive', '--format=tar', commit], {
      cwd: root,
      maxBuffer: 1 << 30,
    });
    const unpacked =
      archive.status === 0
        ? spawnSync('tar', ['-x', '-C', folder], {input: archive.stdout})
        : undefined;
    const file = path.join(folder, LAUNCH_TABLE);
    if (unpacked?.status !== 0 || !existsSync(file)) {
      return undefined;
    }
    // the table's imports reach packages (esbuild, yaml), which resolve from the repository's own node_modules
    symlinkSync(
      path.join(root, 'node_modules'),
      path.join(folder, 'node_modules'),
    );
    const before = (await import(pathToFileURL(file).href)) as TableModule;
    return changedLabels(before, after, root);
  } catch {
    return undefined;
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

/** The files under `folder`, relative to `root`, that a source file could import from: TypeScript and JavaScript. */
function sourcesUnder(root: string, folder: string): string[] {
  const absolute = path.join(root, folder);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute, {withFileTypes: true, recursive: true})
    .filter(
      entry =>
        entry.isFile() &&
        /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name) &&
        !/(^|\/)(node_modules|dist[^/]*)(\/|$)/.test(
          path.relative(absolute, entry.parentPath),
        ),
    )
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)));
}

/** A path without its script extension. */
function stem(file: string): string {
  return file.replace(/\.(ts|mts|cts|js|mjs|cjs)$/, '');
}

/** The files among `sources` that import `target`, all paths relative to `root`. */
function importersOf(
  root: string,
  sources: readonly string[],
  target: string,
): string[] {
  return sources.filter(source => {
    const text = readFileSync(path.join(root, source), 'utf8');
    return [
      ...text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g),
    ].some(
      match =>
        stem(path.join(path.dirname(source), String(match[1]))) ===
        stem(target),
    );
  });
}

/**
 * The test files that stand for a helper of a suite folder: the suite's tests that import it, directly or through
 * another helper of the same folder. Undefined when a file outside the folder imports it or one of those helpers.
 */
export function testsOfHelper(
  root: string,
  helper: string,
  outside: readonly string[] = ['tests', 'tools', 'packages'],
): string[] | undefined {
  const folder = path.dirname(helper);
  const sources = outside.flatMap(each => sourcesUnder(root, each));
  const tests = new Set<string>();
  const seen = new Set<string>();
  const pending = [helper];
  while (pending.length > 0) {
    const current = String(pending.pop());
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const importer of importersOf(root, sources, current)) {
      if (path.dirname(importer) !== folder) {
        return undefined;
      }
      if (importer.endsWith('.test.ts')) {
        tests.add(importer);
      } else {
        pending.push(importer);
      }
    }
  }
  return [...tests].sort();
}

/** A suite folder's own helper: a script directly in tests/acceptance/<suite>/ that is not a test. */
const SUITE_HELPER =
  /^tests\/acceptance\/(?!windows\/)[^/]+\/[^/]+\.(ts|mts|cts|js|mjs|cjs)$/;

/**
 * The changed paths with each helper of a launch's suite folder (`suites`) replaced by the tests that stand for it. A
 * helper that a file outside its folder imports, that no test imports, or that is in a folder no launch runs stays as
 * it is, and so reaches every launch. The shared windows harness is never a suite's helper.
 */
export function withHelpersAsTests(
  changed: readonly string[],
  root: string,
  suites: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      changed.flatMap(file => {
        if (
          !SUITE_HELPER.test(file) ||
          file.endsWith('.test.ts') ||
          !suites.has(path.basename(path.dirname(file)))
        ) {
          return [file];
        }
        const tests = testsOfHelper(root, file);
        return tests === undefined || tests.length === 0 ? [file] : tests;
      }),
    ),
  ];
}
