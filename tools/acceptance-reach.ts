/**
 * @fileoverview acceptance-reach: what a change to the launch table or to a suite's own helper reaches, measured from
 * the files rather than assumed. A change to tools/acceptance-launches.ts whose changed declarations are `launchesOf`
 * and what only it uses reaches the launches whose entries differ between the base and the head; a helper in a suite
 * folder that only that suite's tests import stands for those tests. Anything the measurement cannot account for
 * (an export, what an export uses, an import, a value with no text of its own) reaches every launch, as before.
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
import typescript from 'typescript';
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

/**
 * A value as text holds it: a function as its source, a map as its entries, a set as its members, a pattern as its
 * source and flags. Any other object of its own class has no text that would show its changes, so it throws.
 */
function heldAsText(...entry: [string, unknown]): unknown {
  const held = entry[1];
  if (typeof held === 'function') {
    return `function ${String(held)}`;
  }
  if (held instanceof Map) {
    return ['map', ...(held as Map<unknown, unknown>)];
  }
  if (held instanceof Set) {
    return ['set', ...(held as Set<unknown>)];
  }
  if (held instanceof RegExp) {
    return `pattern ${String(held)}`;
  }
  if (
    typeof held === 'object' &&
    held !== null &&
    !Array.isArray(held) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(held) as object)
  ) {
    throw new Error('a value with no text of its own');
  }
  return held;
}

/** The text of a value: functions as their source, maps as their entries. */
function textOf(value: unknown): string {
  return JSON.stringify(value, heldAsText);
}

/** Each launch's fingerprint by label: its entry, its group, its settings and whether it needs the dev container image. */
function fingerprintsOf(table: TableModule, root: string): Map<string, string> {
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
  try {
    if (restOf(before) !== restOf(after)) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const earlier = fingerprintsOf(before, root);
  return [...fingerprintsOf(after, root)]
    .filter(([label, print]) => earlier.get(label) !== print)
    .map(([label]) => label);
}

/** The names a top-level statement declares, or one name standing for a statement that declares none. */
function namesOf(statement: typescript.Statement, index: number): string[] {
  if (
    typescript.isFunctionDeclaration(statement) ||
    typescript.isClassDeclaration(statement) ||
    typescript.isInterfaceDeclaration(statement) ||
    typescript.isTypeAliasDeclaration(statement) ||
    typescript.isEnumDeclaration(statement)
  ) {
    return [statement.name?.text ?? `<statement ${String(index)}>`];
  }
  if (typescript.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map(declaration =>
      typescript.isIdentifier(declaration.name)
        ? declaration.name.text
        : `<statement ${String(index)}>`,
    );
  }
  return [
    typescript.isImportDeclaration(statement)
      ? '<imports>'
      : `<statement ${String(index)}>`,
  ];
}

/** Each top-level declaration of a source text: its text (without comments), whether it is exported, and the names it uses. */
function declarationsOf(
  text: string,
): Map<string, {text: string; exported: boolean; uses: Set<string>}> {
  const source = typescript.createSourceFile(
    LAUNCH_TABLE,
    text,
    typescript.ScriptTarget.Latest,
    true,
  );
  const declarations = new Map<
    string,
    {text: string; exported: boolean; uses: Set<string>}
  >();
  source.statements.forEach((statement, index) => {
    const uses = new Set<string>();
    function visit(node: typescript.Node): void {
      if (typescript.isIdentifier(node)) {
        uses.add(node.text);
      }
      typescript.forEachChild(node, visit);
    }
    typescript.forEachChild(statement, visit);
    const exported =
      typescript.canHaveModifiers(statement) &&
      (typescript.getModifiers(statement) ?? []).some(
        modifier => modifier.kind === typescript.SyntaxKind.ExportKeyword,
      );
    for (const name of namesOf(statement, index)) {
      const earlier = declarations.get(name);
      declarations.set(name, {
        text: `${earlier?.text ?? ''}${statement.getText(source)}`,
        exported: exported || earlier?.exported === true,
        uses: new Set([...(earlier?.uses ?? []), ...uses]),
      });
    }
  });
  return declarations;
}

/** The declarations `starts` use, and the ones those use, over the declarations of both texts. */
function usedBy(
  starts: readonly string[],
  graphs: ReadonlyArray<Map<string, {uses: Set<string>}>>,
): Set<string> {
  const reached = new Set<string>();
  const pending = [...starts];
  while (pending.length > 0) {
    const name = String(pending.pop());
    for (const graph of graphs) {
      for (const used of graph.get(name)?.uses ?? []) {
        if (graph.has(used) && !reached.has(used)) {
          reached.add(used);
          pending.push(used);
        }
      }
    }
  }
  return reached;
}

/**
 * Whether a change to the launch table's text can be measured through its launches: every top-level declaration
 * that differs is `launchesOf` or something only `launchesOf` uses. A change to an import, to a statement that names
 * nothing, or to a declaration an exported value or function other than `launchesOf` uses reaches every launch.
 */
export function measurableEdit(before: string, after: string): boolean {
  const earlier = declarationsOf(before);
  const current = declarationsOf(after);
  const changed = [...new Set([...earlier.keys(), ...current.keys()])].filter(
    name => earlier.get(name)?.text !== current.get(name)?.text,
  );
  const graphs = [earlier, current];
  const exported = [...earlier, ...current]
    .filter(
      ([name, declaration]) => declaration.exported && name !== 'launchesOf',
    )
    .map(([name]) => name);
  const outsideTable = usedBy(exported, graphs);
  const insideTable = usedBy(['launchesOf'], graphs);
  return changed.every(
    name =>
      !name.startsWith('<') &&
      !exported.includes(name) &&
      !outsideTable.has(name) &&
      (name === 'launchesOf' || insideTable.has(name)),
  );
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
    if (
      !measurableEdit(
        readFileSync(file, 'utf8'),
        readFileSync(path.join(root, LAUNCH_TABLE), 'utf8'),
      )
    ) {
      return undefined;
    }
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
      ...text.matchAll(
        /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g,
      ),
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
