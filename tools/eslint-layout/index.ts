// ESLint plugin for the import rules of docs/architecture/layout.md:
//   rule 3  an extension never imports another extension;
//   rule 4  a library never imports an extension, and the library graph has no cycles.
// A package is a folder in packages/; a folder named lib-* is a library, every other folder is an extension.
// A package reaches another package only by its package name, declared as a `workspace:` dependency (layout.md,
// rule 4), so a relative path into another package's folder is reported too. Cycles are found in the graph of
// declared workspace dependencies, which is the graph pnpm links. Aliases in manifests and tsconfig `paths` are
// checked by tools/check-workspace.ts, not here.
//
// Checked: import and export declarations, `import()` and `require()` with a string or a template literal without
// substitutions, `import x = require()`, `import('...')` types and `declare module '...'`. A computed specifier in
// `import()` or `require()` is reported on its own. Known and accepted gaps, left to code review: an inline
// `eslint-disable` of this rule, `createRequire`, `require.resolve`, `import.meta.resolve` and triple-slash type
// references.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Rule } from 'eslint';

interface Package {
  name: string;
  folder: string;
  library: boolean;
  deps: string[];
}

interface Workspace {
  byName: Map<string, Package>;
  byFolder: Map<string, Package>;
}

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

// Read on every file so that an editor's long-running ESLint sees package.json edits; a workspace has few packages.
function readWorkspace(root: string): Workspace {
  const byName = new Map<string, Package>();
  const byFolder = new Map<string, Package>();
  const dir = path.join(root, 'packages');
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, entry.name, 'package.json'), 'utf8')) as Manifest;
    } catch {
      continue; // tools/check-layout reports a folder that is not a workspace
    }
    const deps = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    });
    const pkg: Package = {
      name: manifest.name ?? entry.name,
      folder: entry.name,
      library: entry.name.startsWith('lib-'),
      deps,
    };
    byName.set(pkg.name, pkg);
    byFolder.set(pkg.folder, pkg);
  }
  return { byName, byFolder };
}

// The first path segment below packages/ (a package folder, or a file directly in packages/), or undefined outside.
function folderOf(root: string, file: string): string | undefined {
  const rel = path.relative(path.join(root, 'packages'), file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep)[0];
}

interface SpecifierNode {
  type: string;
  value?: unknown;
  expressions?: unknown[];
  quasis?: { value: { cooked?: string | null | undefined } }[];
}

// The string a specifier node holds; null when it is computed. A template literal without substitutions counts as
// a string.
function specifierOf(node: SpecifierNode): string | null {
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) return node.quasis?.[0]?.value.cooked ?? null;
  return null;
}

// The package name a bare specifier names: `a/b` -> `a`, `@s/a/b` -> `@s/a`.
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

// A chain of declared dependencies from `from` to `to`, or undefined.
function findPath(ws: Workspace, from: Package, to: Package): string[] | undefined {
  const seen = new Set<string>();
  const walk = (pkg: Package): string[] | undefined => {
    if (pkg === to) return [pkg.name];
    if (seen.has(pkg.name)) return undefined;
    seen.add(pkg.name);
    for (const dep of pkg.deps) {
      const next = ws.byName.get(dep);
      const rest = next && walk(next);
      if (rest) return [pkg.name, ...rest];
    }
    return undefined;
  };
  return walk(from);
}

const packageImports: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce the import rules of docs/architecture/layout.md between packages' },
    schema: [
      {
        type: 'object',
        properties: { root: { type: 'string' } },
        required: ['root'],
        additionalProperties: false,
      },
    ],
    messages: {
      extensionImportsExtension:
        'Extension {{from}} imports extension {{to}}; extensions talk only through spec interfaces (layout.md rule 3).',
      libraryImportsExtension: 'Library {{from}} imports extension {{to}} (layout.md rule 4).',
      cycle: 'Import of {{to}} from {{from}} closes a package cycle: {{chain}} (layout.md rule 4).',
      relative: "Relative import into package folder '{{folder}}'; import the package by its name.",
      computed: 'Computed module specifier; use a string so the package import rules can check it.',
    },
  },
  create(context) {
    const { root } = context.options[0] as { root: string };
    const ownFolder = folderOf(root, context.filename);
    if (ownFolder === undefined) return {};
    const ws = readWorkspace(root);
    const own = ws.byFolder.get(ownFolder);
    if (!own) return {};

    const check = (node: Rule.Node, source: unknown): void => {
      if (typeof source !== 'string') return;
      let target: Package | undefined;
      if (source.startsWith('.') || path.isAbsolute(source)) {
        const folder = folderOf(root, path.resolve(path.dirname(context.filename), source));
        if (folder === undefined || folder === ownFolder) return;
        context.report({ node, messageId: 'relative', data: { folder } });
        target = ws.byFolder.get(folder);
      } else {
        target = ws.byName.get(packageName(source));
      }
      if (!target || target === own) return;
      const data = { from: own.name, to: target.name };
      if (!target.library) {
        context.report({
          node,
          messageId: own.library ? 'libraryImportsExtension' : 'extensionImportsExtension',
          data,
        });
        return;
      }
      const back = findPath(ws, target, own);
      if (back)
        context.report({ node, messageId: 'cycle', data: { ...data, chain: [own.name, ...back].join(' -> ') } });
    };

    // import() and require(): a computed argument is reported, since its target cannot be checked.
    const checkCall = (node: Rule.Node, arg: SpecifierNode): void => {
      const source = specifierOf(arg);
      if (source === null) context.report({ node, messageId: 'computed' });
      else check(node, source);
    };

    // typescript-eslint nodes, which the ESLint listener types do not name.
    const tsListeners: Record<string, (node: never) => void> = {
      // import x = require('...')
      TSExternalModuleReference: (node: Rule.Node & { expression: SpecifierNode }) => checkCall(node, node.expression),
      // type T = import('...').T
      TSImportType: (node: Rule.Node & { argument?: SpecifierNode & { literal?: SpecifierNode } }) => {
        const arg = node.argument?.type === 'TSLiteralType' ? node.argument.literal : node.argument;
        if (arg) checkCall(node, arg);
      },
      // declare module '...' { ... }
      TSModuleDeclaration: (node: Rule.Node & { id: SpecifierNode }) => {
        if (node.id.type === 'Literal') check(node, node.id.value);
      },
    };

    return {
      ...tsListeners,
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => checkCall(node, node.source),
      CallExpression: (node) => {
        const [arg] = node.arguments;
        if (node.callee.type === 'Identifier' && node.callee.name === 'require' && arg) checkCall(node, arg);
      },
    };
  },
};

export default {
  meta: { name: 'layout' },
  rules: { 'package-imports': packageImports },
};
