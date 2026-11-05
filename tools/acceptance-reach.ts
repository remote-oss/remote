/**
 * @fileoverview acceptance-reach: what a change to the launch table, the parts table, a suite's own helper or a package
 * reaches, measured from the files rather than assumed. A change to tools/acceptance-launches.ts whose changed
 * declarations are `launchesOf` and what only it uses reaches the launches whose entries differ between the base and
 * the head; a change to the parts table reaches the launches of the parts it makes otherwise; a helper in a suite
 * folder that only that suite's tests import stands for those tests; a change to a package reaches the launches that
 * install an extension built from it, and those that run a test importing it. Anything the measurement cannot account
 * for (an export, what an export uses, an import, a value with no text of its own, a package it cannot place) reaches
 * every launch, as before.
 */

import {execFileSync, spawnSync} from 'node:child_process';
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
import {
  type Part,
  partsOfTable,
  type PartsTable,
  suiteFilesIn,
} from './acceptance-parts.ts';
import {isInside, isLibraryFolder} from './repository.ts';

/** The launch table's file, as a changed path names it. */
export const LAUNCH_TABLE = 'tools/acceptance-launches.ts';

/** The parts table's file, as a changed path names it. */
export const PARTS_TABLE_FILE = 'tools/acceptance-parts.json';

/**
 * Paths no launch can reach: documentation, unit tests, and the selection's own two modules (acceptance-select.ts and
 * this one), which only the plan runs: no source of the harness imports them, as a row checks, so a run of the
 * launches cannot show a change to them right or wrong. A closed list: any other path runs more, never less.
 */
export const NO_LAUNCH = [
  /^docs\//,
  /\.md$/,
  /^packages\/[^/]+\/test\/unit\//,
  /^tools\/.*\.test\.ts$/,
  /^tools\/acceptance-(select|reach)\.ts$/,
];

/** A suite's own test file, directly in its folder: `[suite, file]`. */
export const SUITE_TEST = /^tests\/acceptance\/([^/]+)\/([^/]+\.test\.ts)$/;

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

/**
 * The files under `folder`, relative to `root`, that a source file could import from: TypeScript and JavaScript, outside
 * the installed packages, the build outputs and the hidden folders (the type checker's `.tsc`).
 */
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
        !/(^|\/)(node_modules|dist[^/]*|\.[^/]+)(\/|$)/.test(
          path.relative(absolute, entry.parentPath),
        ),
    )
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)));
}

/** A path without its script extension. */
function stem(file: string): string {
  return file.replace(/\.(ts|mts|cts|js|mjs|cjs)$/, '');
}

/** The modules a source's text names by a string: imports, re-exports, side-effect and dynamic imports, requires. */
function specifiersOf(text: string): string[] {
  return [
    ...text.matchAll(
      /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ].map(match => String(match[1]));
}

/** Whether a specifier names a path relative to its source rather than a package. */
function isRelative(specifier: string): boolean {
  return /^\.{1,2}\//.test(specifier);
}

/** The files among `sources` that import `target`, all paths relative to `root`. */
function importersOf(
  root: string,
  sources: readonly string[],
  target: string,
): string[] {
  return sources.filter(source =>
    specifiersOf(readFileSync(path.join(root, source), 'utf8')).some(
      specifier =>
        isRelative(specifier) &&
        stem(path.join(path.dirname(source), specifier)) === stem(target),
    ),
  );
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

/** The extension folders whose launches install them, by the extension's id. */
const PACKAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['remote-containers', 'remote-oss.remote-containers'],
  ['remote-explorer', 'remote-oss.remote-explorer'],
]);

/** The folder of the acceptance tests' own package. */
const ACCEPTANCE = 'tests/acceptance';

/** The folders pnpm-workspace.yaml must list for the graph to know every package. */
const WORKSPACE = ['packages/*', ACCEPTANCE];

/** What the package reach reads: who uses each package folder, and who imports each source. */
export interface SourceGraph {
  /** Per package folder, the package folders whose package.json depends on it at run time. */
  dependents: Map<string, Set<string>>;
  /** Per package folder, the sources outside it that import it, by its name or by a path into it. */
  users: Map<string, Set<string>>;
  /** Per source without its extension, the sources that import it by a relative path. */
  importers: Map<string, Set<string>>;
  /** Whether a source imports the acceptance package by its name, which the relative importers do not show. */
  acceptanceByName: boolean;
}

/** The scripts directly in `root`, beside the folders the graph reads. */
function rootSources(root: string): string[] {
  return readdirSync(root, {withFileTypes: true})
    .filter(
      entry => entry.isFile() && /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name),
    )
    .map(entry => entry.name);
}

/** The package a bare specifier names: its first segment, or its first two for a scoped name. */
function packageNameOf(specifier: string): string {
  return specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
}

/** Adds `value` to the set of `key` in `sets`. */
function addTo(
  sets: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  sets.set(key, (sets.get(key) ?? new Set()).add(value));
}

/**
 * The graph of the repository's packages and sources, or undefined when pnpm-workspace.yaml lists other folders than
 * the ones it reads. A package's run-time dependents are the packages whose `dependencies`, `optionalDependencies` or
 * `peerDependencies` name it; its users are the sources of packages/, tests/ and tools/, and the scripts in the root,
 * that import it by its name or by a relative path into its folder. Unit tests are not in the graph: no launch runs
 * them, and their fixtures' text is not an import.
 */
export function sourceGraph(root: string): SourceGraph | undefined {
  const listed = [
    ...readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8').matchAll(
      /^\s+-\s+(\S+)\s*$/gm,
    ),
  ].map(match => String(match[1]));
  if (listed.join() !== WORKSPACE.join()) {
    return undefined;
  }
  const folders = [
    ...readdirSync(path.join(root, 'packages'), {withFileTypes: true})
      .filter(entry => entry.isDirectory())
      .map(entry => `packages/${entry.name}`),
    ACCEPTANCE,
  ];
  const manifests = new Map(
    folders.map(folder => [
      folder,
      JSON.parse(
        readFileSync(path.join(root, folder, 'package.json'), 'utf8'),
      ) as {name?: string} & Record<string, Record<string, string> | undefined>,
    ]),
  );
  const folderOf = new Map(
    [...manifests].map(([folder, manifest]) => [String(manifest.name), folder]),
  );
  const graph: SourceGraph = {
    dependents: new Map(),
    users: new Map(),
    importers: new Map(),
    acceptanceByName: false,
  };
  for (const [folder, manifest] of manifests) {
    if (folder === ACCEPTANCE) {
      continue;
    }
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        const used = folderOf.get(name);
        if (used !== undefined) {
          addTo(graph.dependents, used, folder);
        }
      }
    }
  }
  const sources = [
    ...['packages', 'tests', 'tools'].flatMap(folder =>
      sourcesUnder(root, folder),
    ),
    ...rootSources(root),
  ].filter(source => !NO_LAUNCH.some(pattern => pattern.test(source)));
  for (const source of sources) {
    for (const specifier of specifiersOf(
      readFileSync(path.join(root, source), 'utf8'),
    )) {
      const target = isRelative(specifier)
        ? path.join(path.dirname(source), specifier)
        : undefined;
      if (target !== undefined) {
        addTo(graph.importers, stem(target), source);
      }
      const used =
        target === undefined
          ? folderOf.get(packageNameOf(specifier))
          : folders.find(folder => isInside(folder, target));
      graph.acceptanceByName ||= target === undefined && used === ACCEPTANCE;
      if (used !== undefined && !isInside(used, source)) {
        addTo(graph.users, used, source);
      }
    }
  }
  return graph;
}

/** The labels of the launches that pass `test`, in the table's order. */
function labelsWhere(
  launches: readonly Launch[],
  test: (launch: Launch) => boolean,
): string[] {
  return launches.filter(test).map(launch => launch.label);
}

/**
 * The launches that run a source of the acceptance tests, or undefined when one is run some other way. The VSCodium
 * run bundles the suite folders of its launches, each folder's own `*.test.ts` files and what they import
 * (`bundleSuite` and `bundleFolder` in tools/acceptance.ts): a source reaches the launches of each such test that
 * imports it, directly or through other sources. A test of a folder no launch has as its suite, that nothing imports,
 * runs in no launch. A source that no test imports (the hold every suite loads, an extension's entry point), or that a
 * file outside the acceptance tests imports, reaches every launch.
 */
function testReach(
  graph: SourceGraph,
  source: string,
  launches: readonly Launch[],
): string[] | undefined {
  if (graph.acceptanceByName) {
    return undefined;
  }
  const labels = new Set<string>();
  const seen = new Set<string>();
  const pending = [source];
  while (pending.length > 0) {
    const current = String(pending.pop());
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const own = stem(current);
    const importers = [
      ...(graph.importers.get(own) ?? []),
      ...(path.basename(own) === 'index'
        ? (graph.importers.get(path.dirname(own)) ?? [])
        : []),
    ];
    if (importers.some(importer => !isInside(ACCEPTANCE, importer))) {
      return undefined;
    }
    const suite = SUITE_TEST.exec(current)?.[1];
    if (suite === undefined && importers.length === 0) {
      return undefined;
    }
    if (suite !== undefined) {
      for (const label of labelsWhere(
        launches,
        launch => launch.suite === suite,
      )) {
        labels.add(label);
      }
    }
    pending.push(...importers);
  }
  return [...labels];
}

/** The extension ids a launch installs (plain launches name them in `withExtensions`; runner launches install none). */
function extensionsOfLaunch(launch: Launch): readonly string[] {
  return launch.kind === 'plain' ? (launch.withExtensions ?? []) : [];
}

/**
 * The launches a change to the package in `folder` (packages/<name>) can reach, or undefined when it can reach every
 * launch: the launches that install an extension built from the package or from a package that depends on it, at run
 * time or by an import, and the launches that run a test importing one of those packages. A package the reach cannot
 * place reaches every launch: an extension folder no launch carries by its id (remote-ssh runs in every launch), a
 * user outside packages/ and the acceptance tests (the harness under tools/), and a package that reaches no launch,
 * since that is not shown by the imports alone.
 */
export function packageReach(
  graph: SourceGraph,
  folder: string,
  launches: readonly Launch[],
): string[] | undefined {
  const labels = new Set<string>();
  const seen = new Set<string>();
  const pending = [folder];
  while (pending.length > 0) {
    const current = String(pending.pop());
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const name = path.basename(current);
    const extension = PACKAGE_EXTENSIONS.get(name);
    if (extension !== undefined) {
      for (const label of labelsWhere(launches, launch =>
        extensionsOfLaunch(launch).includes(extension),
      )) {
        labels.add(label);
      }
    } else if (!isLibraryFolder(name)) {
      return undefined;
    }
    pending.push(...(graph.dependents.get(current) ?? []));
    for (const user of graph.users.get(current) ?? []) {
      const owner = /^packages\/[^/]+/.exec(user)?.[0];
      const reach =
        owner === undefined && isInside(ACCEPTANCE, user)
          ? testReach(graph, user, launches)
          : undefined;
      if (owner !== undefined) {
        pending.push(owner);
      } else if (reach === undefined) {
        return undefined;
      } else {
        for (const label of reach) {
          labels.add(label);
        }
      }
    }
  }
  return labels.size === 0
    ? undefined
    : labelsWhere(launches, launch => labels.has(launch.label));
}

/**
 * The reach measured at `root`, the head, for the changed paths it can place: each path in a package's folder that is
 * not a unit test, by its package (the graph is read once, and only when such a path changed), and the parts table, by
 * the parts it makes otherwise than at `base`.
 */
export function measuredPaths(
  changed: readonly string[],
  base: string,
  launches: readonly Launch[],
  root: string,
): Map<string, readonly string[]> {
  const paths = changed.filter(
    file =>
      /^packages\/[^/]+\//.test(file) &&
      !NO_LAUNCH.some(pattern => pattern.test(file)),
  );
  const graph = paths.length === 0 ? undefined : sourceGraph(root);
  const reached = new Map<string, readonly string[] | undefined>();
  const measured = new Map<string, readonly string[]>();
  for (const file of paths) {
    const folder = file.split('/').slice(0, 2).join('/');
    if (graph !== undefined && !reached.has(folder)) {
      reached.set(folder, packageReach(graph, folder, launches));
    }
    const reach = reached.get(folder);
    if (reach !== undefined) {
      measured.set(file, reach);
    }
  }
  const parts = changed.includes(PARTS_TABLE_FILE)
    ? labelsOfTableSince(base, launches, root)
    : undefined;
  if (parts !== undefined) {
    measured.set(PARTS_TABLE_FILE, parts);
  }
  return measured;
}

/** A part as a run makes it: its launches, in their order, and its time limit. */
function madeAs(part: Part): string {
  return `${part.launches} ${String(part.minutes)}`;
}

/**
 * The labels of the launches in the parts that differ between the table `before` and the table `after`, both packed
 * from `launches`: a part of `after` that `before` has not, with the same launches in the same order and the same
 * limit. A launch held with another is in its part, so it comes with it. Only the plan reads the table, so a part made
 * as before runs as before.
 */
export function labelsOfChangedParts(
  before: PartsTable,
  after: PartsTable,
  launches: readonly Launch[],
  suiteFiles: (suite: string) => string[],
): string[] {
  const made = new Set(partsOfTable(launches, before, suiteFiles).map(madeAs));
  const labels = new Set(
    partsOfTable(launches, after, suiteFiles)
      .filter(part => !made.has(madeAs(part)))
      .flatMap(part =>
        part.launches.split(',').map(entry => entry.split(':')[0] ?? ''),
      ),
  );
  return launches
    .map(launch => launch.label)
    .filter(label => labels.has(label));
}

/**
 * The labels whose parts a change of the parts table since `base` makes otherwise, both tables packed from the head's
 * launches so that only the table's change counts; undefined, so every launch, when the base's table can't be read or
 * packed.
 */
export function labelsOfTableSince(
  base: string,
  launches: readonly Launch[],
  root: string,
): string[] | undefined {
  try {
    return labelsOfChangedParts(
      JSON.parse(
        execFileSync('git', ['show', `${base}:${PARTS_TABLE_FILE}`], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      ) as PartsTable,
      JSON.parse(
        readFileSync(path.join(root, PARTS_TABLE_FILE), 'utf8'),
      ) as PartsTable,
      launches,
      suiteFilesIn(root),
    );
  } catch {
    return undefined;
  }
}
