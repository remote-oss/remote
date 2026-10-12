/**
 * @fileoverview ESLint rules for the import rules of docs/architecture/layout.md: an extension never imports
 * another extension (rule 3); a library never imports an extension, and the library graph has no cycles (rule 4);
 * and no package has an import cycle between its own source files.
 *
 * A package is a folder in packages/; a folder named lib-* is a library, every other folder an extension. A package
 * reaches another package only by its package name, so a relative path into another package's folder is reported
 * too. Cycles are found in the graph of declared workspace dependencies, which is the graph pnpm links; aliases in
 * manifests and tsconfig `paths` are tools/check-workspace.ts's part.
 *
 * Checked: import and export declarations, `import()` and `require()` with a string or a template literal without
 * substitutions, `import name = require()`, `import('...')` types and `declare module '...'`; a computed specifier
 * in `import()` or `require()` is reported on its own. Known gaps, left to review: an inline `eslint-disable` of
 * this rule, `createRequire`, `require.resolve`, `import.meta.resolve` and triple-slash type references.
 *
 * The intra-package rule resolves the relative imports a package's src/ carries — static and `import type`
 * declarations, `export … from`, and `import()` with a literal — and reports every cycle once, from the
 * lexicographically first file of the cycle, naming the files in order. Test files are out of scope; files outside
 * src/ are not nodes. Known gaps, left to review: a specifier inside a regular expression, a comment between the
 * keyword and its string, and files whose extension is not .ts, .mts or .cts.
 */

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import type {Rule} from 'eslint';
import {isLibraryFolder, packageFolders} from '../repository.ts';

interface LayoutPackage {
  name: string;
  folder: string;
  isLibrary: boolean;
  dependencies: string[];
}

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface SpecifierNode {
  type: string;
  value?: unknown;
  expressions?: unknown[];
  quasis?: Array<{value: {cooked?: string | null | undefined}}>;
}

/** A node whose specifier is a node of its own: `import()`, `import name = require()` and `import('...')` types. */
type CallLikeNode = Rule.Node & {
  expression?: SpecifierNode;
  argument?: SpecifierNode & {literal?: SpecifierNode};
};

function readLayoutPackages(root: string): LayoutPackage[] {
  const found: LayoutPackage[] = [];
  for (const folder of packageFolders(root)) {
    const file = path.join(root, 'packages', folder, 'package.json');
    if (!existsSync(file)) {
      continue;
    }
    // A package.json is an object of this shape; tools/check-workspace.ts reports one that cannot be read.
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
    found.push({
      name: manifest.name ?? folder,
      folder,
      isLibrary: isLibraryFolder(folder),
      dependencies: Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      }),
    });
  }
  return found;
}

/** The first path segment below `<root>/packages`, or undefined for a path outside it. */
function packageFolderOf(root: string, file: string): string | undefined {
  const relative = path.relative(path.join(root, 'packages'), file);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative.split(path.sep)[0];
}

/** The string a specifier node holds, or null when it is computed; a template without substitutions is a string. */
function specifierText(node: SpecifierNode): string | null {
  if (node.type === 'Literal') {
    return typeof node.value === 'string' ? node.value : null;
  }
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) {
    return node.quasis?.[0]?.value.cooked ?? null;
  }
  return null;
}

/** The package a bare specifier names: `name/sub` gives `name`, `@scope/name/sub` gives `@scope/name`. */
function bareSpecifierPackage(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : (segments[0] ?? specifier);
}

class ImportChecker {
  private readonly context: Rule.RuleContext;
  private readonly root: string;
  private readonly owner: LayoutPackage;
  private readonly packagesByName: Map<string, LayoutPackage>;
  private readonly packagesByFolder: Map<string, LayoutPackage>;

  constructor(
    context: Rule.RuleContext,
    root: string,
    owner: LayoutPackage,
    packages: LayoutPackage[],
  ) {
    this.context = context;
    this.root = root;
    this.owner = owner;
    this.packagesByName = new Map(packages.map(entry => [entry.name, entry]));
    this.packagesByFolder = new Map(
      packages.map(entry => [entry.folder, entry]),
    );
  }

  checkSource(node: Rule.Node, source: unknown): void {
    if (typeof source !== 'string') {
      return;
    }
    const target = this.targetOf(node, source);
    if (target === undefined || target === this.owner) {
      return;
    }
    const data = {importer: this.owner.name, imported: target.name};
    if (!target.isLibrary) {
      const messageId = this.owner.isLibrary
        ? 'libraryImportsExtension'
        : 'extensionImportsExtension';
      this.context.report({node, messageId, data});
      return;
    }
    const chain = this.dependencyChain(target, new Set());
    if (chain !== undefined) {
      this.context.report({
        node,
        messageId: 'cycle',
        data: {...data, chain: [this.owner.name, ...chain].join(' -> ')},
      });
    }
  }

  checkSpecifierNode(node: Rule.Node, specifier: SpecifierNode): void {
    const source = specifierText(specifier);
    if (source === null) {
      this.context.report({node, messageId: 'computed'});
    } else {
      this.checkSource(node, source);
    }
  }

  checkCallLike(node: CallLikeNode): void {
    const argument = node.argument;
    const specifier =
      node.expression ??
      (argument?.type === 'TSLiteralType' ? argument.literal : argument);
    if (specifier !== undefined) {
      this.checkSpecifierNode(node, specifier);
    }
  }

  private targetOf(node: Rule.Node, source: string): LayoutPackage | undefined {
    if (!source.startsWith('.') && !path.isAbsolute(source)) {
      return this.packagesByName.get(bareSpecifierPackage(source));
    }
    const resolved = path.resolve(path.dirname(this.context.filename), source);
    const folder = packageFolderOf(this.root, resolved);
    if (folder === undefined || folder === this.owner.folder) {
      return undefined;
    }
    this.context.report({node, messageId: 'relative', data: {folder}});
    return this.packagesByFolder.get(folder);
  }

  /** A chain of declared dependencies from `start` back to the owner, or undefined when there is none. */
  private dependencyChain(
    start: LayoutPackage,
    visited: Set<string>,
  ): string[] | undefined {
    if (start === this.owner) {
      return [start.name];
    }
    if (visited.has(start.name)) {
      return undefined;
    }
    visited.add(start.name);
    for (const dependency of start.dependencies) {
      const next = this.packagesByName.get(dependency);
      const rest =
        next === undefined ? undefined : this.dependencyChain(next, visited);
      if (rest !== undefined) {
        return [start.name, ...rest];
      }
    }
    return undefined;
  }
}

const packageImports: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce the import rules of docs/architecture/layout.md between packages',
    },
    schema: [
      {
        type: 'object',
        properties: {root: {type: 'string'}},
        required: ['root'],
        additionalProperties: false,
      },
    ],
    messages: {
      extensionImportsExtension:
        'Extension {{importer}} imports extension {{imported}}; extensions talk only through spec interfaces (layout.md rule 3).',
      libraryImportsExtension:
        'Library {{importer}} imports extension {{imported}} (layout.md rule 4).',
      cycle:
        'Import of {{imported}} from {{importer}} closes a package cycle: {{chain}} (layout.md rule 4).',
      relative:
        "Relative import into package folder '{{folder}}'; import the package by its name.",
      computed:
        'Computed module specifier; use a string so the package import rules can check it.',
    },
  },
  create(context) {
    // The schema above makes the option an object with a string `root`.
    const {root} = context.options[0] as {root: string};
    const ownFolder = packageFolderOf(root, context.filename);
    // The package list is read for every file, so that a long-running ESLint in an editor sees manifest edits.
    const packages = ownFolder === undefined ? [] : readLayoutPackages(root);
    const owner = packages.find(entry => entry.folder === ownFolder);
    if (owner === undefined) {
      return {};
    }
    const checker = new ImportChecker(context, root, owner, packages);
    // The typescript-eslint node types are not in ESLint's listener map, so these handlers are typed by hand.
    const typescriptListeners: Record<string, (node: never) => void> = {
      TSExternalModuleReference(node: CallLikeNode) {
        checker.checkCallLike(node);
      },
      TSImportType(node: CallLikeNode) {
        checker.checkCallLike(node);
      },
      TSModuleDeclaration(node: Rule.Node & {id: SpecifierNode}) {
        if (node.id.type === 'Literal') {
          checker.checkSource(node, node.id.value);
        }
      },
    };
    return {
      ...typescriptListeners,
      ImportDeclaration(node) {
        checker.checkSource(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        checker.checkSource(node, node.source?.value);
      },
      ExportAllDeclaration(node) {
        checker.checkSource(node, node.source.value);
      },
      ImportExpression(node) {
        checker.checkSpecifierNode(node, node.source);
      },
      CallExpression(node) {
        const [argument] = node.arguments;
        const isRequire =
          node.callee.type === 'Identifier' && node.callee.name === 'require';
        if (isRequire && argument !== undefined) {
          checker.checkSpecifierNode(node, argument);
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// layout/no-intra-package-cycles

/** A quoted literal the scanner reads: its text, the index after its end, and whether a template has no substitutions. */
interface LiteralReading {
  readonly text: string;
  readonly end: number;
  readonly plain: boolean;
}

function isQuote(character: string | undefined): boolean {
  return character === "'" || character === '"' || character === '`';
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

/**
 * The index after the literal that opens at `start`: a quote, a template, or the end of the text when the literal
 * never closes.
 */
function literalEnd(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  let depth = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '`' && depth > 0) {
      index = literalEnd(source, index);
      continue;
    }
    if (character === '$' && source[index + 1] === '{') {
      depth += 1;
      index += 2;
      continue;
    }
    if (character === '}' && depth > 0) {
      depth -= 1;
      index += 1;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function afterWhitespace(source: string, index: number): number {
  while (index < source.length) {
    const character = source[index];
    if (
      character === ' ' ||
      character === '\t' ||
      character === '\n' ||
      character === '\r'
    ) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

/** True where the text at `index` is the word `word`, not a part of a longer identifier. */
function isKeyword(source: string, index: number, word: string): boolean {
  if (
    isIdentifierCharacter(source[index - 1]) ||
    !source.startsWith(word, index)
  ) {
    return false;
  }
  return !isIdentifierCharacter(source[index + word.length]);
}

/** The quoted literal that follows a `from` clause or an `import()` argument, or null where none follows. */
function quoteAfter(source: string, index: number): LiteralReading | null {
  if (!isQuote(source[index])) {
    return null;
  }
  const end = literalEnd(source, index);
  const content = source.slice(index + 1, end - 1);
  if (source[index] === '`' && content.includes('${')) {
    return {text: '', end, plain: false};
  }
  return {text: content, end, plain: true};
}

/**
 * The relative import specifiers a source text carries: the `from` clauses of import and export declarations,
 * side-effect imports, and `import()` with a literal argument. Comments and the inside of strings do not count,
 * and a computed argument does not.
 */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '/') {
      const lineEnd = source.indexOf('\n', index);
      index = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const blockEnd = source.indexOf('*/', index + 2);
      index = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }
    if (isQuote(character)) {
      index = literalEnd(source, index);
      continue;
    }
    if (isKeyword(source, index, 'from')) {
      const clause = quoteAfter(source, afterWhitespace(source, index + 4));
      if (clause?.plain) {
        specifiers.push(clause.text);
        index = clause.end;
        continue;
      }
      index += 4;
      continue;
    }
    if (isKeyword(source, index, 'import')) {
      const memberAccess = source[index - 1] === '.';
      const argumentStart = afterWhitespace(source, index + 6);
      if (!memberAccess && source[argumentStart] === '(') {
        const clause = quoteAfter(source, argumentStart + 1);
        if (clause?.plain) {
          specifiers.push(clause.text);
          index = clause.end;
          continue;
        }
      } else if (!memberAccess && isQuote(source[argumentStart])) {
        const clause = quoteAfter(source, argumentStart);
        if (clause?.plain) {
          specifiers.push(clause.text);
          index = clause.end;
          continue;
        }
      }
      index += 6;
      continue;
    }
    index += 1;
  }
  return specifiers;
}

/** The src/-relative paths of a package's source files: test and fixture files out of scope. */
function packageSourceFiles(srcDir: string): string[] {
  const files: string[] = [];
  function visit(folder: string): void {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!/\.(ts|mts|cts)$/.test(entry.name)) {
        continue;
      }
      if (/\.(test|fixture)\.(ts|mts|cts)$/.test(entry.name)) {
        continue;
      }
      files.push(path.relative(srcDir, absolute).split(path.sep).join('/'));
    }
  }
  visit(srcDir);
  return files.sort();
}

/** The src/-relative path a relative specifier of `importer` resolves to within `files`, or undefined. */
function resolveIntra(
  srcDir: string,
  files: ReadonlySet<string>,
  importer: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return undefined;
  }
  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    const relative = path.relative(srcDir, candidate).split(path.sep).join('/');
    if (!relative.startsWith('..') && files.has(relative)) {
      return relative;
    }
  }
  return undefined;
}

interface IntraGraphEntry {
  readonly fingerprint: string;
  readonly graph: Map<string, string[]>;
  readonly cycles: string[][];
}

const intraGraphCache = new Map<string, IntraGraphEntry>();

/**
 * The module graph of one package's src/: each file's resolved relative imports, and its cycles, each found once
 * and starting at its lexicographically first file. The read is cached by the files' sizes and modification
 * times, so a long-running ESLint in an editor sees edits.
 */
function intraGraphOf(root: string, folder: string): Map<string, string[]> {
  const srcDir = path.join(root, 'packages', folder, 'src');
  const files = packageSourceFiles(srcDir);
  const fingerprint = files
    .map(file => {
      const info = statSync(path.join(srcDir, file));
      return `${file}:${String(info.size)}:${String(info.mtimeMs)}`;
    })
    .join('|');
  const cached = intraGraphCache.get(`${root}/${folder}`);
  if (cached?.fingerprint === fingerprint) {
    return cached.graph;
  }
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const absolute = path.join(srcDir, file);
    const targets = new Set<string>();
    for (const specifier of importSpecifiers(readFileSync(absolute, 'utf8'))) {
      const target = resolveIntra(srcDir, fileSet, absolute, specifier);
      if (target !== undefined) {
        targets.add(target);
      }
    }
    graph.set(file, [...targets].sort());
  }
  intraGraphCache.set(`${root}/${folder}`, {
    fingerprint,
    graph,
    cycles: elementaryCycles(graph),
  });
  return graph;
}

/** Every cycle of `graph`, each once: `a.ts → b.ts → a.ts`, starting at the lexicographically first file. */
function elementaryCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  for (const start of [...graph.keys()].sort()) {
    const onPath = new Set<string>([start]);
    function visit(current: string, journey: string[]): void {
      for (const next of graph.get(current) ?? []) {
        if (next === start) {
          cycles.push([...journey, start]);
          continue;
        }
        // A cycle is found only from its smallest file, so each one is found once.
        if (next < start || onPath.has(next)) {
          continue;
        }
        onPath.add(next);
        journey.push(next);
        visit(next, journey);
        journey.pop();
        onPath.delete(next);
      }
    }
    visit(start, [start]);
  }
  return cycles;
}

const noIntraPackageCycles: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Report every import cycle between the source files of one package, each once, naming the files in order',
    },
    schema: [
      {
        type: 'object',
        properties: {root: {type: 'string'}},
        required: ['root'],
        additionalProperties: false,
      },
    ],
    messages: {
      cycle:
        'Import cycle inside the package: {{chain}}; the layout forbids cycles.',
    },
  },
  create(context) {
    // The schema above makes the option an object with a string `root`.
    const {root} = context.options[0] as {root: string};
    const relative = path.relative(
      path.join(root, 'packages'),
      context.filename,
    );
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return {};
    }
    const segments = relative.split(path.sep);
    const [folder, kind, ...rest] = segments;
    // Only a file under <package>/src/ is a node of the graph; test files are out of scope.
    if (folder === undefined || kind !== 'src' || rest.length === 0) {
      return {};
    }
    const sourceFile = rest.join(path.sep);
    const srcDir = path.join(root, 'packages', folder, 'src');
    const graph = intraGraphOf(root, folder);
    const cycles = elementaryCycles(graph).filter(
      chain => chain[0] === sourceFile,
    );
    if (cycles.length === 0) {
      return {};
    }
    const fileSet = new Set(graph.keys());
    const edges: Array<{node: Rule.Node; target: string}> = [];
    function record(
      node: Rule.Node,
      source: SpecifierNode | null | undefined,
    ): void {
      if (source == null) {
        return;
      }
      const specifier = specifierText(source);
      if (specifier === null) {
        return;
      }
      const target = resolveIntra(srcDir, fileSet, context.filename, specifier);
      if (target !== undefined) {
        edges.push({node, target});
      }
    }
    return {
      ImportDeclaration(node: Rule.Node & {source: SpecifierNode}) {
        record(node, node.source);
      },
      ExportNamedDeclaration(
        node: Rule.Node & {source?: SpecifierNode | null | undefined},
      ) {
        record(node, node.source);
      },
      ExportAllDeclaration(node: Rule.Node & {source: SpecifierNode}) {
        record(node, node.source);
      },
      ImportExpression(node: Rule.Node & {source: SpecifierNode}) {
        record(node, node.source);
      },
      'Program:exit'() {
        for (const chain of cycles) {
          const edge = edges.find(candidate => candidate.target === chain[1]);
          if (edge !== undefined) {
            context.report({
              node: edge.node,
              messageId: 'cycle',
              data: {chain: chain.join(' → ')},
            });
          }
        }
      },
    };
  },
};

/** The `layout` plugin: `package-imports` and `no-intra-package-cycles`. */
export const layoutPlugin = {
  meta: {name: 'layout'},
  rules: {
    'no-intra-package-cycles': noIntraPackageCycles,
    'package-imports': packageImports,
  },
};
