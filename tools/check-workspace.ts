/**
 * @fileoverview check-workspace: the configuration side of layout.md rules 3 and 4, run by tools/check-layout.
 *
 * A package reaches another package only by its package name, declared as a `workspace:` dependency (layout.md,
 * rule 4). ESLint checks the imports; this checks every route an import can resolve through: package manifests,
 * the root manifest, pnpm-workspace.yaml and .npmrc, tsconfigs resolved through `extends`, symbolic links, and the
 * links an install creates in node_modules.
 */

import {spawnSync} from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import typescript from 'typescript';
import {parse as parseYaml} from 'yaml';
import {
  isInside,
  isLibraryFolder,
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
  sortedEntries,
  resolveBinary,
} from './repository.ts';

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

const UNWALKED_FOLDERS = new Set([
  '.git',
  'node_modules',
  '.tsc',
  'dist',
  '.vscode-test',
  'coverage',
]);

const NPMRC_HOISTING_KEYS = [
  'node-linker',
  'shamefully-hoist',
  'public-hoist-pattern',
  'pnpmfile',
  'global-pnpmfile',
];

// TS18002 (empty "files") and TS18003 (no inputs) are the normal state of a project without sources.
const EMPTY_PROJECT_DIAGNOSTICS = new Set([18002, 18003]);

type DependencyMap = Record<string, string>;

interface Manifest {
  name?: string;
  private?: boolean;
  imports?: unknown;
  pnpm?: unknown;
  resolutions?: unknown;
  overrides?: unknown;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
}

interface WorkspaceFile {
  packages?: unknown;
  linkWorkspacePackages?: unknown;
  pnpmfile?: unknown;
  globalPnpmfile?: unknown;
  catalog?: DependencyMap;
  catalogs?: Record<string, DependencyMap>;
  overrides?: unknown;
  packageExtensions?: unknown;
  nodeLinker?: unknown;
  shamefullyHoist?: unknown;
  publicHoistPattern?: unknown;
}

interface WorkspacePackage {
  folder: string;
  directory: string;
  manifestDir: string;
  name: string;
  isLibrary: boolean;
  acceptance: boolean;
  manifest: Manifest;
}

/** The package a `name@range` alias names: `remote-wsl@*` gives `remote-wsl`, `@scope/name@^1` gives `@scope/name`. */
function aliasTarget(specifier: string): string | undefined {
  const separator = specifier.indexOf('@', specifier.startsWith('@') ? 1 : 0);
  return separator > 0 ? specifier.slice(0, separator) : undefined;
}

function nestedStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(nestedStrings);
  }
  return [];
}

function* filesBelow(directory: string): Generator<string> {
  for (const entry of sortedEntries(directory)) {
    const fullPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) {
      yield fullPath;
    } else if (!UNWALKED_FOLDERS.has(entry.name)) {
      yield* filesBelow(fullPath);
    }
  }
}

function isTsconfig(file: string): boolean {
  return /^tsconfig.*\.json$/.test(path.basename(file));
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The links directly in `<directory>/node_modules`, scoped ones included, with what each resolves to. */
function installedLinks(directory: string): Array<[string, string]> {
  const modules = path.join(directory, 'node_modules');
  if (!existsSync(modules)) {
    return [];
  }
  const names = sortedEntries(modules)
    .filter(entry => !entry.name.startsWith('.'))
    .flatMap(entry =>
      entry.name.startsWith('@')
        ? sortedEntries(path.join(modules, entry.name)).map(
            scoped => `${entry.name}/${scoped.name}`,
          )
        : [entry.name],
    );
  const links: Array<[string, string]> = [];
  for (const name of names) {
    const fullPath = path.join(modules, name);
    if (lstatSync(fullPath).isSymbolicLink()) {
      try {
        links.push([name, realpathSync(fullPath)]);
      } catch {
        // A dangling link resolves to nothing, so it reaches no package.
      }
    }
  }
  return links;
}

class WorkspaceChecker {
  readonly problems: string[] = [];
  private readonly root: string;
  private readonly packagesDirectory: string;
  private readonly packages: WorkspacePackage[];
  private readonly packagesByName: Map<string, WorkspacePackage>;
  private readonly workspaceFile: WorkspaceFile;
  private readonly rootManifest: Manifest;
  private readonly tscPath: string;
  private readonly realDirectories = new Map<WorkspacePackage, string>();
  private readonly dependencyGraph = new Map<
    WorkspacePackage,
    Set<WorkspacePackage>
  >();

  constructor(root: string) {
    this.root = root;
    this.packagesDirectory = path.join(root, 'packages');
    this.packages = this.readPackages();
    this.packagesByName = new Map(
      this.packages.map(workspacePackage => [
        workspacePackage.name,
        workspacePackage,
      ]),
    );
    this.workspaceFile = this.readFile('pnpm-workspace.yaml', parseYaml) ?? {};
    this.rootManifest = this.readFile('package.json', JSON.parse) ?? {};
    this.tscPath = resolveBinary('typescript/lib/tsc.js');
  }

  findProblems(): string[] {
    this.checkWorkspaceFile();
    this.checkHookFiles();
    this.checkPackageManifests();
    this.checkRootManifest();
    this.checkConfigurationRoutes();
    this.checkHoisting();
    this.checkTsconfigs();
    this.checkSymbolicLinks();
    this.checkInstalledLinks();
    this.checkDependencyCycles();
    this.checkConsumption();
    return this.problems;
  }

  private relative(file: string): string {
    return path.relative(this.root, file);
  }

  private readFile(file: string, parse: (text: string) => unknown): unknown {
    try {
      return parse(readFileSync(path.join(this.root, file), 'utf8'));
    } catch (error) {
      this.problems.push(`${file}: cannot be read: ${messageOf(error)}`);
      return undefined;
    }
  }

  private readPackages(): WorkspacePackage[] {
    const found: WorkspacePackage[] = [];
    for (const folder of packageFolders(this.root)) {
      const file = path.join('packages', folder, 'package.json');
      if (existsSync(path.join(this.root, file))) {
        // A package.json is an object of this shape; every field is checked where it is read.
        const manifest = this.readFile(file, JSON.parse) as
          Manifest | undefined;
        if (manifest !== undefined) {
          found.push({
            folder,
            directory: path.join(this.packagesDirectory, folder),
            manifestDir: `packages/${folder}`,
            name: manifest.name ?? folder,
            isLibrary: isLibraryFolder(folder),
            acceptance: false,
            manifest,
          });
        }
      }
    }
    // The acceptance package sits outside packages/: the one package that may import any extension or
    // library, and the one nothing may import (layout.md, the acceptance package).
    const acceptanceFile = path.join('tests', 'acceptance', 'package.json');
    if (existsSync(path.join(this.root, acceptanceFile))) {
      const manifest = this.readFile(acceptanceFile, JSON.parse) as
        Manifest | undefined;
      if (manifest !== undefined) {
        found.push({
          folder: 'acceptance',
          directory: path.join(this.root, 'tests', 'acceptance'),
          manifestDir: 'tests/acceptance',
          name: manifest.name ?? 'acceptance',
          isLibrary: false,
          acceptance: true,
          manifest,
        });
      }
    }
    return found;
  }

  private packageAt(file: string): WorkspacePackage | undefined {
    return this.packages.find(candidate => isInside(candidate.directory, file));
  }

  private checkWorkspaceFile(): void {
    const {packages: globs, linkWorkspacePackages} = this.workspaceFile;
    const expected = ['packages/*', 'tests/acceptance'];
    if (JSON.stringify(globs) !== JSON.stringify(expected)) {
      this.problems.push(
        `pnpm-workspace.yaml: packages is ${JSON.stringify(globs)}, expected ${JSON.stringify(expected)}`,
      );
    }
    if (linkWorkspacePackages !== undefined) {
      this.problems.push('pnpm-workspace.yaml: sets linkWorkspacePackages');
    }
  }

  private checkHookFiles(): void {
    const directories = [
      this.root,
      ...this.packages.map(owner => owner.directory),
    ];
    for (const directory of directories) {
      for (const entry of sortedEntries(directory)) {
        if (/^\.?pnpmfile\.[cm]?js$/.test(entry.name)) {
          this.problems.push(
            `${this.relative(path.join(directory, entry.name))}: pnpm hook file`,
          );
        }
      }
    }
    for (const setting of ['pnpmfile', 'globalPnpmfile'] as const) {
      if (this.workspaceFile[setting] !== undefined) {
        this.problems.push(`pnpm-workspace.yaml: sets ${setting}`);
      }
    }
  }

  /**
   * The workspace package that the dependency `name: specifier`, declared in `fromDirectory`, resolves to. Every
   * route other than `workspace:` under the target's own name is reported with the prefix `where`.
   */
  private resolveRoute(
    where: string,
    name: string,
    specifier: string,
    fromDirectory: string,
  ): WorkspacePackage | undefined {
    const protocol = /^(catalog|workspace|npm|link|file):/.exec(specifier)?.[1];
    const rest = specifier.slice((protocol?.length ?? -1) + 1);
    switch (protocol) {
      case 'catalog':
        return this.resolveCatalogRoute(where, name, rest || 'default');
      case 'workspace':
        return this.resolveWorkspaceRoute(where, name, rest);
      case 'npm':
        return this.resolveNpmRoute(where, rest);
      case 'link':
      case 'file':
        this.problems.push(
          `${where} uses ${protocol}:; dependencies are workspace: or registry packages`,
        );
        return this.packageAt(path.resolve(fromDirectory, rest));
      default:
        if (this.packagesByName.has(name)) {
          this.problems.push(
            `${where} names a workspace package without the workspace: protocol`,
          );
        }
        return this.packagesByName.get(name);
    }
  }

  private resolveCatalogRoute(
    where: string,
    name: string,
    catalogName: string,
  ): WorkspacePackage | undefined {
    const catalogs: Record<string, DependencyMap> = {
      default: this.workspaceFile.catalog ?? {},
      ...this.workspaceFile.catalogs,
    };
    if (this.packagesByName.has(name)) {
      this.problems.push(
        `${where} names workspace package ${name} through catalog:`,
      );
    }
    const entry = catalogs[catalogName]?.[name];
    return entry === undefined
      ? this.packagesByName.get(name)
      : this.resolveRoute(
          `${where} (catalog ${catalogName})`,
          name,
          entry,
          this.root,
        );
  }

  private resolveWorkspaceRoute(
    where: string,
    name: string,
    range: string,
  ): WorkspacePackage | undefined {
    const alias = aliasTarget(range);
    if (alias !== undefined && alias !== name) {
      this.problems.push(`${where} aliases ${alias}`);
    }
    const target = this.packagesByName.get(alias ?? name);
    if (target === undefined) {
      this.problems.push(`${where} names no workspace package`);
    }
    return target;
  }

  private resolveNpmRoute(
    where: string,
    aliased: string,
  ): WorkspacePackage | undefined {
    const name = aliasTarget(aliased) ?? aliased;
    const target = this.packagesByName.get(name);
    if (target !== undefined) {
      this.problems.push(
        `${where} aliases workspace package ${name} through npm:`,
      );
    }
    return target;
  }

  /** Reports `owner` reaching `target` when the target is an extension other than the owner itself. */
  private checkReach(
    owner: WorkspacePackage,
    target: WorkspacePackage | undefined,
    where: string,
  ): void {
    if (target === undefined || target === owner) {
      return;
    }
    if (owner.acceptance) {
      return;
    }
    if (target.acceptance) {
      this.problems.push(
        `${where}: nothing may depend on the acceptance package`,
      );
      return;
    }
    if (target.isLibrary) {
      return;
    }
    this.problems.push(
      owner.isLibrary
        ? `${where}: library ${owner.name} reaches extension ${target.name} (layout.md rule 4)`
        : `${where}: extension ${owner.name} reaches extension ${target.name} (layout.md rule 3)`,
    );
  }

  private checkPackageManifests(): void {
    for (const owner of this.packages) {
      const where = `${owner.manifestDir}/package.json`;
      const {manifest} = owner;
      if (manifest.private !== true) {
        this.problems.push(`${where}: "private" is not true`);
      }
      for (const field of DEPENDENCY_FIELDS) {
        for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
          const label = `${where}: ${field}.${name}`;
          const target = this.resolveRoute(
            label,
            name,
            specifier,
            owner.directory,
          );
          this.checkReach(owner, target, label);
          this.recordDependency(owner, target);
        }
      }
      for (const target of nestedStrings(manifest.imports)) {
        const resolved = path.resolve(owner.directory, target);
        if (!target.startsWith('./') || !isInside(owner.directory, resolved)) {
          this.problems.push(
            `${where}: imports target '${target}' is outside the package`,
          );
        }
      }
      for (const field of ['pnpm', 'resolutions', 'overrides'] as const) {
        if (manifest[field] !== undefined) {
          this.problems.push(
            `${where}: "${field}" belongs in the root, not a package`,
          );
        }
      }
    }
  }

  private checkRootManifest(): void {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, specifier] of Object.entries(
        this.rootManifest[field] ?? {},
      )) {
        const label = `package.json: ${field}.${name}`;
        const target = this.resolveRoute(label, name, specifier, this.root);
        if (target !== undefined) {
          this.problems.push(
            `${label} links workspace package ${target.name} into the root`,
          );
        }
      }
    }
  }

  private workspaceNameIn(text: string): string | undefined {
    const names = [...this.packagesByName.keys()].sort(
      (left, right) => right.length - left.length,
    );
    return names.find(name =>
      new RegExp(`(^|[^\\w@/.-])${escapeForPattern(name)}($|[^\\w/-])`).test(
        text,
      ),
    );
  }

  private checkRouteValue(where: string, value: unknown): void {
    if (typeof value === 'string') {
      const named = this.workspaceNameIn(
        value.replace(/^(workspace|npm|catalog):/, ' '),
      );
      if (named !== undefined) {
        this.problems.push(
          `${where}: '${value}' routes to workspace package ${named}`,
        );
      } else if (/^(link|file):/.test(value)) {
        this.problems.push(`${where}: '${value}' uses ${value.slice(0, 5)}`);
      }
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const named = this.workspaceNameIn(entryKey);
      if (named !== undefined) {
        this.problems.push(
          `${where}: key '${entryKey}' names workspace package ${named}`,
        );
      }
      this.checkRouteValue(`${where}.${entryKey}`, entryValue);
    }
  }

  private checkConfigurationRoutes(): void {
    const sources: Array<[string, unknown]> = [
      ['package.json: pnpm', this.rootManifest.pnpm],
      ['package.json: resolutions', this.rootManifest.resolutions],
      ['package.json: overrides', this.rootManifest.overrides],
      ['pnpm-workspace.yaml: overrides', this.workspaceFile.overrides],
      [
        'pnpm-workspace.yaml: packageExtensions',
        this.workspaceFile.packageExtensions,
      ],
      ['pnpm-workspace.yaml: catalog', this.workspaceFile.catalog],
      ['pnpm-workspace.yaml: catalogs', this.workspaceFile.catalogs],
    ];
    for (const [where, value] of sources) {
      this.checkRouteValue(where, value);
    }
  }

  private checkHoisting(): void {
    const {nodeLinker, shamefullyHoist, publicHoistPattern} =
      this.workspaceFile;
    if (nodeLinker !== undefined && nodeLinker !== 'isolated') {
      this.problems.push(
        `pnpm-workspace.yaml: nodeLinker ${JSON.stringify(nodeLinker)}; only 'isolated' keeps packages apart`,
      );
    }
    if (shamefullyHoist === true) {
      this.problems.push(
        'pnpm-workspace.yaml: shamefullyHoist hoists into the root',
      );
    }
    if (publicHoistPattern !== undefined) {
      this.problems.push(
        'pnpm-workspace.yaml: publicHoistPattern hoists into the root',
      );
    }
    const directories = [
      this.root,
      ...this.packages.map(owner => owner.directory),
    ];
    for (const npmrc of directories.map(directory =>
      path.join(directory, '.npmrc'),
    )) {
      const text = existsSync(npmrc) ? readFileSync(npmrc, 'utf8') : '';
      for (const setting of NPMRC_HOISTING_KEYS) {
        if (new RegExp(`^\\s*${setting}(\\[\\])?\\s*=`, 'm').test(text)) {
          this.problems.push(`${this.relative(npmrc)}: sets ${setting}`);
        }
      }
    }
  }

  private checkTsconfigs(): void {
    const tsconfigs = [
      ...sortedEntries(this.root)
        .map(entry => path.join(this.root, entry.name))
        .filter(isTsconfig),
      ...[...filesBelow(this.packagesDirectory)].filter(isTsconfig),
    ];
    for (const file of tsconfigs) {
      this.checkTsconfig(file);
    }
  }

  private checkTsconfig(file: string): void {
    const where = this.relative(file);
    const diagnostics: typescript.Diagnostic[] = [];
    const host: typescript.ParseConfigFileHost = {
      ...typescript.sys,
      onUnRecoverableConfigFileDiagnostic: diagnostic =>
        diagnostics.push(diagnostic),
    };
    const parsed = typescript.getParsedCommandLineOfConfigFile(
      file,
      undefined,
      host,
    );
    for (const diagnostic of [...diagnostics, ...(parsed?.errors ?? [])]) {
      if (!EMPTY_PROJECT_DIAGNOSTICS.has(diagnostic.code)) {
        const text = typescript.flattenDiagnosticMessageText(
          diagnostic.messageText,
          ' ',
        );
        this.problems.push(`${where}: ${text}`);
      }
    }
    if (parsed === undefined) {
      return;
    }
    for (const entry of parsed.options.types ?? []) {
      const isPackageName = /^(@[^/.][^/]*\/)?[^/.][^/]*$/.test(entry);
      if (!isPackageName) {
        this.problems.push(
          `${where}: types entry '${entry}' is a path; name a package`,
        );
      }
    }
    for (const option of ['paths', 'baseUrl', 'rootDirs'] as const) {
      if (parsed.options[option] !== undefined) {
        this.problems.push(
          `${where}: sets ${option}; packages reach each other only by package name`,
        );
      }
    }
    const owner = this.packageAt(file);
    if (owner !== undefined) {
      this.checkPackageProject(owner, where, parsed);
    }
  }

  private checkPackageProject(
    owner: WorkspacePackage,
    where: string,
    parsed: typescript.ParsedCommandLine,
  ): void {
    for (const compiled of parsed.fileNames.map(name => path.resolve(name))) {
      if (!isInside(owner.directory, compiled)) {
        this.problems.push(
          `${where}: compiles ${this.relative(compiled)} from outside the package (shared types go in a library)`,
        );
      }
    }
    for (const typeRoot of parsed.options.typeRoots ?? []) {
      if (
        isInside(this.packagesDirectory, typeRoot) &&
        !isInside(owner.directory, typeRoot)
      ) {
        this.problems.push(
          `${where}: typeRoots entry ${this.relative(typeRoot)}`,
        );
      }
    }
    for (const reference of parsed.projectReferences ?? []) {
      const target = this.packageAt(path.resolve(reference.path));
      if (target === undefined || target === owner) {
        continue;
      }
      this.checkReach(
        owner,
        target,
        `${where}: references ${this.relative(reference.path)}`,
      );
      const declared = DEPENDENCY_FIELDS.some(field =>
        owner.manifest[field]?.[target.name]?.startsWith('workspace:'),
      );
      if (target.isLibrary && !declared) {
        this.problems.push(
          `${where}: references ${target.name}, which ${owner.name} does not declare`,
        );
      }
    }
  }

  private checkSymbolicLinks(): void {
    for (const file of filesBelow(this.root)) {
      if (!lstatSync(file).isSymbolicLink()) {
        continue;
      }
      const target = path.resolve(path.dirname(file), readlinkSync(file));
      if (isInside(this.packagesDirectory, file)) {
        this.problems.push(
          `${this.relative(file)}: symbolic link inside packages/`,
        );
      } else if (isInside(this.packagesDirectory, target)) {
        this.problems.push(
          `${this.relative(file)}: symbolic link into packages/`,
        );
      }
    }
  }

  /**
   * After an install, checks what the node_modules links resolve to. A link may resolve into pnpm's store (the
   * root's node_modules) or outside the repository; inside the repository only to an allowed workspace package.
   */
  private checkInstalledLinks(): void {
    for (const [name, resolved] of installedLinks(this.root)) {
      const target = this.linkedPackage(`node_modules/${name}`, resolved);
      if (target !== undefined) {
        this.problems.push(
          `node_modules/${name}: links workspace package ${target.name} into the root`,
        );
      }
    }
    for (const owner of this.packages) {
      for (const [name, resolved] of installedLinks(owner.directory)) {
        const where = `${owner.manifestDir}/node_modules/${name}`;
        const target = this.linkedPackage(where, resolved);
        if (target === undefined || target === owner) {
          continue;
        }
        if (name !== target.name) {
          this.problems.push(
            `${where}: links ${target.name} under another name`,
          );
        }
        this.checkReach(owner, target, where);
      }
    }
  }

  private recordDependency(
    owner: WorkspacePackage,
    target: WorkspacePackage | undefined,
  ): void {
    if (target === undefined || target === owner) {
      return;
    }
    const targets = this.dependencyGraph.get(owner) ?? new Set();
    targets.add(target);
    this.dependencyGraph.set(owner, targets);
  }

  /** A chain of declared dependencies from `start` back to `start`, or undefined when it is in no cycle. */
  private cycleThrough(start: WorkspacePackage): string[] | undefined {
    const visited = new Set<WorkspacePackage>();
    const pending: Array<[WorkspacePackage, string[]]> = [
      [start, [start.name]],
    ];
    for (
      let next = pending.shift();
      next !== undefined;
      next = pending.shift()
    ) {
      const [current, chain] = next;
      for (const target of this.dependencyGraph.get(current) ?? []) {
        if (target === start) {
          return [...chain, start.name];
        }
        if (!visited.has(target)) {
          visited.add(target);
          pending.push([target, [...chain, target.name]]);
        }
      }
    }
    return undefined;
  }

  /** Reports each cycle of declared workspace dependencies once, at its member whose folder sorts first. */
  private checkDependencyCycles(): void {
    const reported = new Set<string>();
    for (const owner of [...this.packages].sort((left, right) =>
      left.folder < right.folder ? -1 : 1,
    )) {
      const chain = this.cycleThrough(owner);
      const members = [...new Set(chain)].sort().join(' ');
      if (chain !== undefined && !reported.has(members)) {
        reported.add(members);
        this.problems.push(
          `${owner.manifestDir}/package.json: dependency cycle ${chain.join(' -> ')} (layout.md rule 4)`,
        );
      }
    }
  }

  /**
   * A consumer's program compiles another package's declaration output, never its sources: the
   * library's `exports` types condition points at its emitted declarations, and a project
   * reference is what makes `tsc` take them. `tsc --listFilesOnly` per package, and every
   * listed source path must be inside the package or in node_modules; a package that compiles
   * another package's sources is named with what is missing, its reference and, when the
   * dependency is undeclared, the dependency.
   */
  private checkConsumption(): void {
    for (const owner of this.packages) {
      if (this.installedWorkspaceTargets(owner).length === 0) {
        continue;
      }
      for (const config of [...filesBelow(owner.directory)].filter(
        isTsconfig,
      )) {
        this.checkConsumerProgram(owner, config);
      }
    }
  }

  /** The workspace packages a package's installed node_modules links reach, except itself. */
  private installedWorkspaceTargets(
    owner: WorkspacePackage,
  ): WorkspacePackage[] {
    const found = new Map<string, WorkspacePackage>();
    for (const [, resolved] of installedLinks(owner.directory)) {
      const target = this.packages.find(
        candidate =>
          candidate !== owner &&
          isInside(this.realDirectory(candidate), resolved),
      );
      if (target !== undefined) {
        found.set(target.name, target);
      }
    }
    return [...found.values()];
  }

  /** The package's directory without symlinks, so a listed path and a package resolve to the same tree. */
  private realDirectory(thePackage: WorkspacePackage): string {
    let real = this.realDirectories.get(thePackage);
    if (real === undefined) {
      real = realpathSync(thePackage.directory);
      this.realDirectories.set(thePackage, real);
    }
    return real;
  }

  private checkConsumerProgram(owner: WorkspacePackage, config: string): void {
    const where = this.relative(config);
    // The config is relative to the root and run there: an absolute path would resolve the
    // referenced project and the node_modules link through different symlinks.
    const result = spawnSync(
      process.execPath,
      [this.tscPath, '-p', where, '--listFilesOnly'],
      {encoding: 'utf8', cwd: this.root},
    );
    const offenders = new Set<WorkspacePackage>();
    for (const line of result.stdout.split('\n')) {
      const file = line.trim();
      if (
        file === '' ||
        /: error TS\d{4}/.test(file) ||
        file.endsWith('.d.ts') ||
        file.includes(`${path.sep}node_modules${path.sep}`)
      ) {
        continue;
      }
      const resolved = path.resolve(this.root, file);
      if (!existsSync(resolved) || !resolved.endsWith('.ts')) {
        continue;
      }
      const real = realpathSync(resolved);
      if (isInside(this.realDirectory(owner), real)) {
        continue;
      }
      const other = this.packages.find(
        candidate =>
          candidate !== owner && isInside(this.realDirectory(candidate), real),
      );
      if (other !== undefined) {
        offenders.add(other);
      }
    }
    for (const other of [...offenders].sort((left, right) =>
      left.name < right.name ? -1 : 1,
    )) {
      const declares = this.declaredDependencyNames(owner).includes(other.name);
      this.problems.push(
        `${where}: compiles ${other.name} sources; ${owner.name} ${
          declares
            ? `declares ${other.name} but is missing a reference to ${other.manifestDir}`
            : `neither declares ${other.name} nor references ${other.manifestDir}`
        }`,
      );
    }
  }

  /** The package names a package declares as `workspace:` dependencies in any dependency field. */
  private declaredDependencyNames(owner: WorkspacePackage): string[] {
    const names = new Set<string>();
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, specifier] of Object.entries(
        owner.manifest[field] ?? {},
      )) {
        if (specifier.startsWith('workspace:')) {
          names.add(name);
        }
      }
    }
    return [...names];
  }

  private linkedPackage(
    where: string,
    resolved: string,
  ): WorkspacePackage | undefined {
    const realRoot = realpathSync(this.root);
    if (
      !isInside(realRoot, resolved) ||
      isInside(path.join(realRoot, 'node_modules'), resolved)
    ) {
      return undefined;
    }
    const found = this.packages.find(candidate =>
      isInside(realpathSync(candidate.directory), resolved),
    );
    if (found === undefined) {
      this.problems.push(
        `${where}: links ${path.relative(realRoot, resolved)}, which is not a workspace package`,
      );
    }
    return found;
  }
}

/** The problems found in the workspace at `root`; an empty list means it keeps layout.md rules 3 and 4. */
export function checkWorkspace(root: string): string[] {
  return new WorkspaceChecker(root).findProblems();
}

if (isMainModule(import.meta.url)) {
  const problems = checkWorkspace(REPOSITORY_ROOT);
  for (const problem of problems) {
    console.error(`check-workspace: ${problem}`);
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
