// check-workspace: the manifest side of layout.md rules 3 and 4, run by tools/check-layout.
//
//   node tools/check-workspace.ts
//
// A package reaches another package only by its package name, declared as a `workspace:` dependency (layout.md,
// rule 4). ESLint checks the imports (tools/eslint-layout); this checks what the imports resolve through:
// - every dependency on a workspace package uses the `workspace:` protocol, under the target's own name (no alias
//   such as `"x": "workspace:remote-wsl@*"` or `"x": "npm:remote-wsl@1"`, no `link:` or `file:` into packages/);
// - no extension lists another extension, and no library lists an extension, in any dependency field;
// - no tsconfig in packages/ or at the root sets `paths` or `baseUrl`;
// - a manifest's `imports` map only points inside its own package.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

type Manifest = Partial<Record<(typeof FIELDS)[number], Record<string, string>>> & {
  name?: string;
  private?: boolean;
  imports?: unknown;
};

interface Package {
  folder: string;
  dir: string;
  name: string;
  library: boolean;
  manifest: Manifest;
}

function readPackages(root: string): Package[] {
  const packagesDir = path.join(root, 'packages');
  const result: Package[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest;
    } catch {
      continue; // check-layout reports a folder without a package.json
    }
    result.push({
      folder: entry.name,
      dir,
      name: manifest.name ?? entry.name,
      library: entry.name.startsWith('lib-'),
      manifest,
    });
  }
  return result;
}

// The package a `name@range` alias names: `remote-wsl@*` -> `remote-wsl`, `@s/a@^1` -> `@s/a`.
function aliasTarget(spec: string): string | undefined {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at > 0 ? spec.slice(0, at) : undefined;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

export function checkWorkspace(root: string): string[] {
  const errors: string[] = [];
  const packages = readPackages(root);
  const byName = new Map(packages.map((p) => [p.name, p]));
  const byDir = new Map(packages.map((p) => [p.dir, p]));
  const packagesDir = path.join(root, 'packages');

  for (const pkg of packages) {
    const where = `packages/${pkg.folder}/package.json`;
    if (pkg.manifest.private !== true) errors.push(`${where}: "private" is not true`);

    for (const field of FIELDS) {
      for (const [key, spec] of Object.entries(pkg.manifest[field] ?? {})) {
        let target: Package | undefined;
        if (spec.startsWith('workspace:')) {
          const alias = aliasTarget(spec.slice('workspace:'.length));
          if (alias !== undefined && alias !== key) errors.push(`${where}: ${field}.${key} aliases ${alias}`);
          target = byName.get(alias ?? key);
          if (!target) errors.push(`${where}: ${field}.${key} names no workspace package`);
        } else if (spec.startsWith('npm:')) {
          const alias = aliasTarget(spec.slice('npm:'.length)) ?? spec.slice('npm:'.length);
          target = byName.get(alias);
          if (target) errors.push(`${where}: ${field}.${key} aliases workspace package ${alias} through npm:`);
        } else if (spec.startsWith('link:') || spec.startsWith('file:')) {
          const resolved = path.resolve(pkg.dir, spec.slice(5));
          const rel = path.relative(packagesDir, resolved);
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
            target = byDir.get(path.join(packagesDir, rel.split(path.sep)[0] ?? ''));
            errors.push(`${where}: ${field}.${key} points into packages/ with ${spec.slice(0, 5)}; use workspace:`);
          }
        } else if (byName.has(key)) {
          target = byName.get(key);
          errors.push(`${where}: ${field}.${key} names a workspace package without the workspace: protocol`);
        }
        if (!target || target === pkg || target.library) continue;
        errors.push(
          pkg.library
            ? `${where}: library ${pkg.name} lists extension ${target.name} in ${field} (layout.md rule 4)`
            : `${where}: extension ${pkg.name} lists extension ${target.name} in ${field} (layout.md rule 3)`,
        );
      }
    }

    for (const target of strings(pkg.manifest.imports)) {
      const rel = path.relative(pkg.dir, path.resolve(pkg.dir, target));
      if (!target.startsWith('./') || rel.startsWith('..') || path.isAbsolute(rel)) {
        errors.push(`${where}: imports target '${target}' is outside the package`);
      }
    }
  }

  const tsconfigs = [
    ...readdirSync(root).filter((f) => /^tsconfig.*\.json$/.test(f)),
    ...packages.flatMap((p) =>
      readdirSync(p.dir)
        .filter((f) => /^tsconfig.*\.json$/.test(f))
        .map((f) => path.join('packages', p.folder, f)),
    ),
  ];
  for (const file of tsconfigs) {
    const { config, error } = ts.readConfigFile(path.join(root, file), ts.sys.readFile);
    if (error) {
      errors.push(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
      continue;
    }
    const options = (config as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
    for (const option of ['paths', 'baseUrl']) {
      if (option in options) errors.push(`${file}: sets ${option}; packages reach each other only by package name`);
    }
  }

  return errors;
}

if (import.meta.main) {
  const errors = checkWorkspace(path.join(import.meta.dirname, '..'));
  for (const e of errors) console.error(`check-workspace: ${e}`);
  process.exit(errors.length === 0 ? 0 : 1);
}
