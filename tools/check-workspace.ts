// check-workspace: the configuration side of layout.md rules 3 and 4, run by tools/check-layout.
//
//   node tools/check-workspace.ts
//
// A package reaches another package only by its package name, declared as a `workspace:` dependency (layout.md,
// rule 4). ESLint checks the imports (tools/eslint-layout); this checks every route an import can resolve through:
// - package manifests: every dependency on a workspace package uses the `workspace:` protocol under the target's
//   own name (no alias, no `npm:` alias of a workspace name, no `link:`/`file:` into packages/, no registry range or
//   `catalog:` entry that names one); no extension lists another extension and no library lists an extension, in
//   any dependency field; `imports` maps stay inside the package; every package is private;
// - the root manifest and pnpm-workspace.yaml: no root dependency, override, package extension, resolution or
//   catalog entry routes to a workspace package (the root's node_modules is visible to every package through
//   Node's parent-folder lookup); no hoisting into the root and no node linker other than `isolated`;
// - tsconfigs (resolved through `extends`): no `paths`, `baseUrl` or `rootDirs`; a package's tsconfig compiles only
//   its own files, takes type roots only from its own folder, and references only its own projects and those of
//   libraries it declares;
// - symbolic links: none inside packages/ and none elsewhere that points into packages/ (node_modules aside);
// - after install: every link in a node_modules folder that resolves into packages/ is one the rules above allow.

import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.tsc', 'dist', '.vscode-test']);

type Deps = Record<string, string>;
type Manifest = Partial<Record<(typeof FIELDS)[number], Deps>> & {
  name?: string;
  private?: boolean;
  imports?: unknown;
  pnpm?: Record<string, unknown>;
  resolutions?: unknown;
  overrides?: unknown;
};

interface WorkspaceFile {
  packages?: unknown;
  linkWorkspacePackages?: unknown;
  pnpmfile?: unknown;
  globalPnpmfile?: unknown;
  catalog?: Deps;
  catalogs?: Record<string, Deps>;
  overrides?: unknown;
  packageExtensions?: unknown;
  nodeLinker?: unknown;
  shamefullyHoist?: unknown;
  publicHoistPattern?: unknown;
}

interface Package {
  folder: string;
  dir: string;
  name: string;
  library: boolean;
  manifest: Manifest;
}

// Directory entries in a fixed order, so reports are the same on every platform.
const entries = (dir: string) => readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1));

function readPackages(root: string, errors: string[]): Package[] {
  const packagesDir = path.join(root, 'packages');
  const result: Package[] = [];
  for (const entry of entries(packagesDir)) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const file = path.join(dir, 'package.json');
    if (!existsSync(file)) continue; // check-layout reports a folder without a package.json
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
    } catch (e) {
      errors.push(`packages/${entry.name}/package.json: cannot be read: ${(e as Error).message}`);
      continue;
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

function inside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Every file below dir, without the folders in SKIP_DIRS.
function* walk(dir: string): Generator<string> {
  for (const entry of entries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) yield* walk(full);
    else if (!entry.isDirectory()) yield full;
  }
}

export function checkWorkspace(root: string): string[] {
  const errors: string[] = [];
  const packages = readPackages(root, errors);
  const byName = new Map(packages.map((p) => [p.name, p]));
  const packagesDir = path.join(root, 'packages');
  const rel = (file: string): string => path.relative(root, file);
  const packageAt = (file: string): Package | undefined => packages.find((p) => inside(p.dir, file));

  const read = <T>(file: string, parse: (text: string) => unknown): T | undefined => {
    try {
      return parse(readFileSync(path.join(root, file), 'utf8')) as T;
    } catch (e) {
      errors.push(`${file}: cannot be read: ${(e as Error).message}`);
      return undefined;
    }
  };
  const workspace = read<WorkspaceFile>('pnpm-workspace.yaml', parseYaml) ?? {};

  // The workspace is packages/* and nothing else: an extra glob would let a package outside packages/ bridge two
  // packages, and linkWorkspacePackages links a workspace package for a plain version range.
  if (JSON.stringify(workspace.packages) !== JSON.stringify(['packages/*'])) {
    errors.push(`pnpm-workspace.yaml: packages is ${JSON.stringify(workspace.packages)}, expected ["packages/*"]`);
  }
  if (workspace.linkWorkspacePackages !== undefined) errors.push('pnpm-workspace.yaml: sets linkWorkspacePackages');

  // pnpm hooks rewrite manifests at install time, out of reach of every check before the install.
  for (const dir of [root, ...packages.map((p) => p.dir)]) {
    for (const e of entries(dir)) {
      if (/^\.?pnpmfile\.[cm]?js$/.test(e.name)) errors.push(`${rel(path.join(dir, e.name))}: pnpm hook file`);
    }
  }
  for (const key of ['pnpmfile', 'globalPnpmfile'] as const) {
    if (workspace[key] !== undefined) errors.push(`pnpm-workspace.yaml: sets ${key}`);
  }
  const catalogs: Record<string, Deps> = { default: workspace.catalog ?? {}, ...workspace.catalogs };

  // The workspace package a dependency `key: spec` declared in `fromDir` resolves to, and whether that route is
  // the allowed one (`workspace:` under the target's own name). `where` prefixes the problems it reports.
  const route = (where: string, key: string, spec: string, fromDir: string): Package | undefined => {
    if (spec.startsWith('catalog:')) {
      const name = spec.slice('catalog:'.length) || 'default';
      const entry = catalogs[name]?.[key];
      if (byName.has(key)) errors.push(`${where} names workspace package ${key} through catalog:`);
      return entry === undefined ? byName.get(key) : route(`${where} (catalog ${name})`, key, entry, root);
    }
    if (spec.startsWith('workspace:')) {
      const alias = aliasTarget(spec.slice('workspace:'.length));
      if (alias !== undefined && alias !== key) errors.push(`${where} aliases ${alias}`);
      const target = byName.get(alias ?? key);
      if (!target) errors.push(`${where} names no workspace package`);
      return target;
    }
    if (spec.startsWith('npm:')) {
      const name = aliasTarget(spec.slice('npm:'.length)) ?? spec.slice('npm:'.length);
      const target = byName.get(name);
      if (target) errors.push(`${where} aliases workspace package ${name} through npm:`);
      return target;
    }
    if (spec.startsWith('link:') || spec.startsWith('file:')) {
      // A folder outside packages/ could re-export any package's source, so these protocols are not used at all.
      errors.push(`${where} uses ${spec.slice(0, 5)}; dependencies are workspace: or registry packages`);
      return packageAt(path.resolve(fromDir, spec.slice(5)));
    }
    if (byName.has(key)) {
      errors.push(`${where} names a workspace package without the workspace: protocol`);
      return byName.get(key);
    }
    return undefined;
  };

  // A package may depend on itself or on a library; never on an extension.
  const allowTarget = (pkg: Package, target: Package | undefined, what: string): void => {
    if (!target || target === pkg || target.library) return;
    errors.push(
      pkg.library
        ? `${what}: library ${pkg.name} reaches extension ${target.name} (layout.md rule 4)`
        : `${what}: extension ${pkg.name} reaches extension ${target.name} (layout.md rule 3)`,
    );
  };

  // Package manifests.
  for (const pkg of packages) {
    const where = `packages/${pkg.folder}/package.json`;
    if (pkg.manifest.private !== true) errors.push(`${where}: "private" is not true`);
    for (const field of FIELDS) {
      for (const [key, spec] of Object.entries(pkg.manifest[field] ?? {})) {
        allowTarget(pkg, route(`${where}: ${field}.${key}`, key, spec, pkg.dir), `${where}: ${field}.${key}`);
      }
    }
    for (const target of strings(pkg.manifest.imports)) {
      if (!target.startsWith('./') || !inside(pkg.dir, path.resolve(pkg.dir, target))) {
        errors.push(`${where}: imports target '${target}' is outside the package`);
      }
    }
    for (const field of ['pnpm', 'resolutions', 'overrides'] as const) {
      if (pkg.manifest[field] !== undefined) errors.push(`${where}: "${field}" belongs in the root, not a package`);
    }
  }

  // The root manifest: nothing in it may route to a workspace package.
  const rootManifest = read<Manifest>('package.json', JSON.parse) ?? {};
  for (const field of FIELDS) {
    for (const [key, spec] of Object.entries(rootManifest[field] ?? {})) {
      const target = route(`package.json: ${field}.${key}`, key, spec, root);
      if (target) errors.push(`package.json: ${field}.${key} links workspace package ${target.name} into the root`);
    }
  }

  // Overrides, package extensions, resolutions and catalogs, in the root manifest or in pnpm-workspace.yaml: any key
  // or value that names or points to a workspace package.
  const configRoutes: [string, unknown][] = [
    ['package.json: pnpm', rootManifest.pnpm],
    ['package.json: resolutions', rootManifest.resolutions],
    ['package.json: overrides', rootManifest.overrides],
    ['pnpm-workspace.yaml: overrides', workspace.overrides],
    ['pnpm-workspace.yaml: packageExtensions', workspace.packageExtensions],
    ['pnpm-workspace.yaml: catalog', workspace.catalog],
    ['pnpm-workspace.yaml: catalogs', workspace.catalogs],
  ];
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const namesIn = (text: string): string | undefined =>
    names.find((n) => new RegExp(`(^|[^\\w@/.-])${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^\\w/-])`).test(text));
  const visit = (where: string, value: unknown): void => {
    if (typeof value === 'string') {
      const named = namesIn(value.replace(/^(workspace|npm|catalog):/, ' '));
      if (named) errors.push(`${where}: '${value}' routes to workspace package ${named}`);
      else if (/^(link|file):/.test(value)) errors.push(`${where}: '${value}' uses ${value.slice(0, 5)}`);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        const named = namesIn(k);
        if (named) errors.push(`${where}: key '${k}' names workspace package ${named}`);
        visit(`${where}.${k}`, v);
      }
    }
  };
  for (const [where, value] of configRoutes) visit(where, value);

  // Hoisting into the root's node_modules makes every hoisted package importable from every package.
  if (workspace.nodeLinker !== undefined && workspace.nodeLinker !== 'isolated') {
    errors.push(
      `pnpm-workspace.yaml: nodeLinker '${String(workspace.nodeLinker)}'; only 'isolated' keeps packages apart`,
    );
  }
  if (workspace.shamefullyHoist === true) errors.push('pnpm-workspace.yaml: shamefullyHoist hoists into the root');
  if (workspace.publicHoistPattern !== undefined) {
    errors.push('pnpm-workspace.yaml: publicHoistPattern hoists into the root');
  }
  for (const npmrc of [root, ...packages.map((p) => p.dir)].map((d) => path.join(d, '.npmrc'))) {
    if (!existsSync(npmrc)) continue;
    const text = readFileSync(npmrc, 'utf8');
    for (const key of ['node-linker', 'shamefully-hoist', 'public-hoist-pattern', 'pnpmfile', 'global-pnpmfile']) {
      // `key=value` and the array spelling `key[]=value`
      if (new RegExp(`^\\s*${key}(\\[\\])?\\s*=`, 'm').test(text)) errors.push(`${rel(npmrc)}: sets ${key}`);
    }
  }

  // tsconfigs at the root and anywhere in packages/, resolved through `extends`.
  const tsconfigs = [
    ...entries(root)
      .filter((e) => /^tsconfig.*\.json$/.test(e.name))
      .map((e) => path.join(root, e.name)),
    ...[...walk(packagesDir)].filter((f) => /^tsconfig.*\.json$/.test(path.basename(f))),
  ];
  for (const file of tsconfigs) {
    const diagnostics: ts.Diagnostic[] = [];
    const host: ts.ParseConfigFileHost = {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => diagnostics.push(d),
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(file, undefined, host);
    // TS18002 (empty "files") and TS18003 (no inputs found) are the normal state of a project without sources.
    for (const d of [...diagnostics, ...(parsed?.errors ?? [])].filter((d) => d.code !== 18002 && d.code !== 18003)) {
      errors.push(`${rel(file)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
    if (!parsed) continue;
    for (const option of ['paths', 'baseUrl', 'rootDirs'] as const) {
      if (parsed.options[option] !== undefined) {
        errors.push(`${rel(file)}: sets ${option}; packages reach each other only by package name`);
      }
    }
    const pkg = packageAt(file);
    if (!pkg) continue;
    const foreign = parsed.fileNames.filter((f) => !inside(pkg.dir, path.resolve(f)));
    for (const f of foreign)
      errors.push(
        `${rel(file)}: compiles ${rel(path.resolve(f))} from outside the package (shared types go in a library)`,
      );
    for (const dir of parsed.options.typeRoots ?? []) {
      if (inside(packagesDir, dir) && !inside(pkg.dir, dir)) errors.push(`${rel(file)}: typeRoots entry ${rel(dir)}`);
    }
    for (const ref of parsed.projectReferences ?? []) {
      const target = packageAt(path.resolve(ref.path));
      if (!target || target === pkg) continue;
      const declared = FIELDS.some((f) => pkg.manifest[f]?.[target.name]?.startsWith('workspace:'));
      allowTarget(pkg, target, `${rel(file)}: references ${rel(ref.path)}`);
      if (target.library && !declared) {
        errors.push(`${rel(file)}: references ${target.name}, which ${pkg.name} does not declare`);
      }
    }
  }

  // Symbolic links outside node_modules.
  for (const file of walk(root)) {
    if (!lstatSync(file).isSymbolicLink()) continue;
    const target = path.resolve(path.dirname(file), readlinkSync(file));
    if (inside(packagesDir, file)) errors.push(`${rel(file)}: symbolic link inside packages/`);
    else if (inside(packagesDir, target)) errors.push(`${rel(file)}: symbolic link into packages/`);
  }

  // After install: what the node_modules links actually resolve to. Skipped before an install.
  const links = (dir: string): [string, string][] => {
    const modules = path.join(dir, 'node_modules');
    if (!existsSync(modules)) return [];
    const result: [string, string][] = [];
    for (const { name: entry } of entries(modules)) {
      if (entry.startsWith('.')) continue;
      const names = entry.startsWith('@')
        ? entries(path.join(modules, entry)).map((n) => `${entry}/${n.name}`)
        : [entry];
      for (const name of names) {
        const full = path.join(modules, name);
        if (!lstatSync(full).isSymbolicLink()) continue;
        try {
          result.push([name, realpathSync(full)]);
        } catch {
          // a dangling link reaches nothing
        }
      }
    }
    return result;
  };
  // A link may resolve into pnpm's store (the root's node_modules) or outside the repository; inside the repository
  // it may only resolve to a workspace package, under the rules above.
  const realRoot = realpathSync(root);
  const realStore = path.join(realRoot, 'node_modules');
  const packageDirs = packages.map((p) => [p, realpathSync(p.dir)] as const);
  const linkTarget = (where: string, real: string): Package | undefined => {
    if (!inside(realRoot, real) || inside(realStore, real)) return undefined;
    const found = packageDirs.find(([, dir]) => inside(dir, real))?.[0];
    if (!found) errors.push(`${where}: links ${path.relative(realRoot, real)}, which is not a workspace package`);
    return found;
  };
  for (const [name, real] of links(root)) {
    const target = linkTarget(`node_modules/${name}`, real);
    if (target) errors.push(`node_modules/${name}: links workspace package ${target.name} into the root`);
  }
  for (const pkg of packages) {
    for (const [name, real] of links(pkg.dir)) {
      const where = `packages/${pkg.folder}/node_modules/${name}`;
      const target = linkTarget(where, real);
      if (!target || target === pkg) continue;
      if (name !== target.name) errors.push(`${where}: links ${target.name} under another name`);
      allowTarget(pkg, target, where);
    }
  }

  return errors;
}

// Run as a script. This does not rely on import.meta.main, so on any Node version that can load the file the check
// runs, and one that cannot load it exits non-zero: the check fails closed.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const errors = checkWorkspace(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  for (const e of errors) console.error(`check-workspace: ${e}`);
  process.exit(errors.length === 0 ? 0 : 1);
}
