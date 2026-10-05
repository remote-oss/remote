/**
 * @fileoverview ESLint rule for the import rules of docs/architecture/layout.md: an extension never imports
 * another extension (rule 3); a library never imports an extension, and the library graph has no cycles (rule 4).
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
 */

import {existsSync, readFileSync} from 'node:fs';
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

/** The `layout` plugin: `package-imports`. */
export const layoutPlugin = {
  meta: {name: 'layout'},
  rules: {'package-imports': packageImports},
};
