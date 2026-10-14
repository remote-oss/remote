/**
 * @fileoverview identifier-consumption: the analysis and report of the consumption check: CI fails on a contributed
 * setting, command or view that no production source consumes.
 *
 * The check reads each package's generated identifier table (never the manifest), decides references with the
 * TypeScript checker, finds modules only tests import with a production-mode knip run, and reports against
 * tools/unconsumed-allowlist.json. `node tools/identifiers.ts --consumed` runs it; `--consumed --release` is the
 * release run, where every allowlist entry without a recorded decision must be wired already.
 */

import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import typescript from 'typescript';
import {messageOf, packageFolders} from './repository.ts';

/** One entry of the allowlist: the contributed key, the work item that wires it, and its slice. */
export interface AllowlistEntry {
  readonly package: string;
  readonly kind: string;
  readonly key: string;
  readonly card: string;
  readonly slice: string;
  readonly decision?: string;
}

const ALLOWLIST_FIELDS = [
  'package',
  'kind',
  'key',
  'card',
  'slice',
  'decision',
] as const;
const ALLOWLIST_REQUIRED = ['package', 'kind', 'key', 'card', 'slice'] as const;

/**
 * Parses the allowlist. The top level is an object with an `entries` array; every entry has exactly the fields
 * ALLOWLIST_FIELDS, `decision` optional. Throws, naming the field, when the shape differs.
 */
export function parseAllowlist(text: string): readonly AllowlistEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`unconsumed-allowlist.json: ${messageOf(error)}`, {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'unconsumed-allowlist.json: the top level must be an object',
    );
  }
  const entries = (parsed as {entries?: unknown}).entries;
  if (!Array.isArray(entries)) {
    throw new Error('unconsumed-allowlist.json: "entries" must be an array');
  }
  return entries.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(
        `unconsumed-allowlist.json: entries[${String(index)}] must be an object`,
      );
    }
    const record = entry as Record<string, unknown>;
    for (const field of Object.keys(record)) {
      if (!(ALLOWLIST_FIELDS as readonly string[]).includes(field)) {
        throw new Error(
          `unconsumed-allowlist.json: entries[${String(index)}] has an unknown field '${field}'`,
        );
      }
    }
    for (const field of ALLOWLIST_REQUIRED) {
      if (typeof record[field] !== 'string') {
        throw new Error(
          `unconsumed-allowlist.json: entries[${String(index)}].${field} must be a string`,
        );
      }
    }
    if (record.decision !== undefined && typeof record.decision !== 'string') {
      throw new Error(
        `unconsumed-allowlist.json: entries[${String(index)}].decision must be a string`,
      );
    }
    return {
      package: record.package as string,
      kind: record.kind as string,
      key: record.key as string,
      card: record.card as string,
      slice: record.slice as string,
      ...(record.decision === undefined ? {} : {decision: record.decision}),
    };
  });
}

/** The generated table file, relative to the package folder. */
const TABLE_FILE = 'src/identifiers.generated.ts';

/** The call names whose argument list consumes a views key. */
const VIEW_REGISTRATIONS = new Set([
  'createTreeView',
  'registerTreeDataProvider',
  'registerWebviewViewProvider',
]);

const REGISTER_COMMANDS = 'registerCommands';

/** An entry of a generated table: the generated key and the id as the table writes it. */
interface TableEntry {
  readonly key: string;
  readonly id: string;
}

/** An entry of the generated file before the R2 filter: the id and, where the entry carries them, role and setter. */
interface RawEntry {
  readonly key: string;
  readonly id: string;
  readonly role?: string;
  readonly setter?: string;
}

/** One exported const of the generated file: the table, its type, its keys, and its checked entries. */
interface TableInfo {
  readonly name: string;
  readonly keys: ReadonlySet<string>;
  readonly type: typescript.Type;
  readonly entries: ReadonlyMap<string, TableEntry>;
  /** For the `standDown` table only: the id of its `contextKey`, which lib-standdown sets. */
  readonly contextKey?: string;
}

/** The result of the §3.2 analysis over one package's production sources. */
interface PackageConsumption {
  /** The folder name of the package. */
  readonly folder: string;
  /** Every checked entry of the package's tables, keyed `kind key`. */
  readonly entries: ReadonlyMap<string, TableEntry>;
  /** The `kind key` of every checked entry a production source consumes. */
  readonly consumed: ReadonlySet<string>;
  /** One `whole table: <file>:<line> uses <table>` line per whole-table use, file relative to the package. */
  readonly notes: readonly string[];
  /**
   * One `src/<file>:<line>: the commands of this registerCommands call can't be seen (type parameter <T>)` line per
   * call whose third argument is a type parameter the pass-through can't resolve, file relative to the package.
   */
  readonly commandProblems: readonly string[];
}

/** The options of the check: the tag run and the knip runner the tests stub. */
export interface ConsumptionOptions {
  /** The tag run: every allowlist entry without a decision must be wired. */
  readonly release?: boolean;
  /** The production-mode knip run; undefined starts the real one. */
  readonly runKnip?: ((root: string) => Promise<string>) | undefined;
}

/** The report: problems in the runner's line order, and the notes. */
export interface ConsumptionReport {
  readonly problems: readonly string[];
  readonly notes: readonly string[];
  /** The message of the first package whose program cannot be built; the exit 2 line. */
  readonly fatal?: string;
}

/** Builds the package's program from its tsconfig.json. Throws, naming the package, when it cannot be built. */
function buildPackageProgram(root: string, folder: string): typescript.Program {
  const configFile = path.join(root, 'packages', folder, 'tsconfig.json');
  if (!existsSync(configFile)) {
    throw new Error(
      `packages/${folder}: the program cannot be built: tsconfig.json is missing`,
    );
  }
  const configErrors: typescript.Diagnostic[] = [];
  const host: typescript.ParseConfigFileHost = {
    ...typescript.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic =>
      configErrors.push(diagnostic),
  };
  const parsed = typescript.getParsedCommandLineOfConfigFile(
    configFile,
    undefined,
    host,
  );
  if (parsed === undefined) {
    const messages = configErrors.map(diagnostic =>
      typescript.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    );
    throw new Error(
      `packages/${folder}: the program cannot be built: ${messages.join('; ')}`,
    );
  }
  for (const diagnostic of parsed.errors) {
    throw new Error(
      `packages/${folder}: the program cannot be built: ${typescript.flattenDiagnosticMessageText(
        diagnostic.messageText,
        ' ',
      )}`,
    );
  }
  if (parsed.fileNames.length === 0) {
    throw new Error(
      `packages/${folder}: the program cannot be built: the project has no files`,
    );
  }
  return typescript.createProgram(
    parsed.fileNames,
    parsed.options,
    typescript.createCompilerHost(parsed.options),
  );
}

/** The string a table entry writes in `field`, when the entry is an object with a string `field`. */
function fieldOf(
  entry: typescript.ObjectLiteralExpression,
  field: string,
): string | undefined {
  for (const property of entry.properties) {
    if (
      typescript.isPropertyAssignment(property) &&
      typescript.isIdentifier(property.name) &&
      property.name.text === field
    ) {
      const value = property.initializer;
      if (
        typescript.isStringLiteral(value) ||
        typescript.isNoSubstitutionTemplateLiteral(value)
      ) {
        return value.text;
      }
    }
  }
  return undefined;
}

/** The entry a table property writes, or undefined when its value is not a literal or an object of literals. */
function entryOf(
  property: typescript.PropertyAssignment,
): RawEntry | undefined {
  if (!typescript.isIdentifier(property.name)) {
    return undefined;
  }
  const value = property.initializer;
  let entryId: string | undefined;
  let role: string | undefined;
  let setter: string | undefined;
  if (typescript.isStringLiteral(value)) {
    entryId = value.text;
  } else if (typescript.isObjectLiteralExpression(value)) {
    entryId = fieldOf(value, 'id');
    role = fieldOf(value, 'role');
    setter = fieldOf(value, 'setter');
  }
  if (entryId === undefined) {
    return undefined;
  }
  return {
    key: property.name.text,
    id: entryId,
    ...(role === undefined ? {} : {role}),
    ...(setter === undefined ? {} : {setter}),
  };
}

/** Whether the table's entry is one the check decides: the R2 kinds, with role and setter where they filter. */
function isCheckedEntry(table: string, entry: RawEntry): boolean {
  if (table === 'internalCommands') {
    return entry.role === 'served';
  }
  if (table === 'contextKeys') {
    return entry.setter === 'extension';
  }
  return ['settings', 'commands', 'views', 'runtimeCommands'].includes(table);
}

/**
 * Reads the package's tables from the generated file: every exported const of an object literal, with its type,
 * its keys, and each key's entry, the R2-filtered ones only.
 */
function tablesOf(
  program: typescript.Program,
  checker: typescript.TypeChecker,
  root: string,
  folder: string,
): readonly TableInfo[] {
  const file = program.getSourceFile(
    path.join(root, 'packages', folder, TABLE_FILE),
  );
  if (file === undefined) {
    return [];
  }
  const tables: TableInfo[] = [];
  for (const statement of file.statements) {
    if (
      !typescript.isVariableStatement(statement) ||
      !statement.modifiers?.some(
        modifier => modifier.kind === typescript.SyntaxKind.ExportKeyword,
      )
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!typescript.isIdentifier(declaration.name)) {
        continue;
      }
      let initializer = declaration.initializer;
      while (
        initializer !== undefined &&
        (typescript.isAsExpression(initializer) ||
          typescript.isTypeAssertionExpression(initializer))
      ) {
        initializer = initializer.expression;
      }
      if (
        initializer === undefined ||
        !typescript.isObjectLiteralExpression(initializer)
      ) {
        continue;
      }
      const type = checker.getTypeAtLocation(declaration.name);
      const keys = new Set<string>();
      const entries = new Map<string, TableEntry>();
      let standDownContextKey: string | undefined;
      for (const property of initializer.properties) {
        if (!typescript.isPropertyAssignment(property)) {
          continue;
        }
        const entry = entryOf(property);
        if (entry === undefined) {
          continue;
        }
        keys.add(entry.key);
        if (isCheckedEntry(declaration.name.text, entry)) {
          entries.set(entry.key, {key: entry.key, id: entry.id});
        }
        if (declaration.name.text === 'standDown' && entry.key === 'contextKey') {
          standDownContextKey = entry.id;
        }
      }
      tables.push({
        name: declaration.name.text,
        keys,
        type,
        entries,
        contextKey: standDownContextKey,
      });
    }
  }
  return tables;
}

/** The sources of the package the walk decides on: production source only. */
function productionFiles(
  program: typescript.Program,
  root: string,
  folder: string,
): readonly typescript.SourceFile[] {
  const prefix = `packages/${folder}/src/`;
  const testing = `packages/${folder}/src/testing/`;
  return program.getSourceFiles().filter(sourceFile => {
    if (sourceFile.isDeclarationFile) {
      return false;
    }
    const relative = path
      .relative(root, sourceFile.fileName)
      .split(path.sep)
      .join('/');
    if (!relative.startsWith(prefix)) {
      return false;
    }
    if (!relative.endsWith('.ts') || relative.endsWith('.test.ts')) {
      return false;
    }
    if (relative.startsWith(testing)) {
      return false;
    }
    return relative !== `packages/${folder}/${TABLE_FILE}`;
  });
}

/**
 * Whether two types are the same: each is assignable to the other. `any` (and an error type) is assignable to
 * everything, so it is no table, and the comparison is false.
 */
function isSameType(
  checker: typescript.TypeChecker,
  left: typescript.Type,
  right: typescript.Type,
): boolean {
  const flags = left.flags | right.flags;
  // In this TypeScript the error type is an intrinsic carrying the Any flag, so the Any check covers both.
  if (flags & typescript.TypeFlags.Any) {
    return false;
  }
  return (
    checker.isTypeAssignableTo(left, right) &&
    checker.isTypeAssignableTo(right, left)
  );
}

/** The string literals a type names, or undefined when it names anything else. */
function literalMembersOf(
  type: typescript.Type,
): readonly string[] | undefined {
  if (type.isStringLiteral()) {
    return [type.value];
  }
  if (type.isUnion()) {
    const members: string[] = [];
    for (const constituent of type.types) {
      if (!constituent.isStringLiteral()) {
        return undefined;
      }
      members.push(constituent.value);
    }
    return members;
  }
  return undefined;
}

/** Whether a set and a list of names are the same set. */
function sameSet(keys: ReadonlySet<string>, list: readonly string[]): boolean {
  if (keys.size !== list.length) {
    return false;
  }
  for (const member of list) {
    if (!keys.has(member)) {
      return false;
    }
  }
  return true;
}

/** The name of a call's function: the identifier, or the last property of an object's port of it. */
function callName(expression: typescript.Expression): string | undefined {
  if (typescript.isIdentifier(expression)) {
    return expression.text;
  }
  if (typescript.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

/**
 * The state of the walk over one package's production sources: the tables, the results so far, and the depth of
 * the view-registration argument lists.
 */
interface WalkState {
  readonly root: string;
  readonly folder: string;
  readonly checker: typescript.TypeChecker;
  readonly tables: readonly TableInfo[];
  readonly productionFiles: readonly typescript.SourceFile[];
  readonly commandArgumentStarts: ReadonlySet<number>;
  /** The [start, end) of a table use the registerCommands rule consumes, by file: no whole-table note inside one. */
  readonly passThroughArguments: ReadonlyMap<
    string,
    ReadonlyArray<readonly [number, number]>
  >;
  readonly consumed: Set<string>;
  readonly notes: Set<string>;
  readonly commandProblems: Set<string>;
  viewArgumentDepth: number;
}

/** The path of a source file relative to the package, with slashes, as the report lines write it. */
function relativeToPackage(root: string, folder: string, file: string): string {
  return path
    .relative(path.join(root, 'packages', folder), file)
    .split(path.sep)
    .join('/');
}

/**
 * The key an access on a table names, and which access it is: a member access `x.K` or an element access `x['K']`
 * where the type of `x` is the table's.
 */
function referenceKeyOf(
  state: WalkState,
  node:
    typescript.PropertyAccessExpression | typescript.ElementAccessExpression,
): string | undefined {
  const objectType = state.checker.getTypeAtLocation(node.expression);
  let key: string | undefined;
  if (typescript.isPropertyAccessExpression(node)) {
    key = node.name.text;
  } else {
    const argument = node.argumentExpression;
    if (
      typescript.isStringLiteral(argument) ||
      typescript.isNoSubstitutionTemplateLiteral(argument)
    ) {
      key = argument.text;
    }
  }
  if (key === undefined) {
    return undefined;
  }
  for (const table of state.tables) {
    if (
      table.name === 'commands' ||
      table.entries.size === 0 ||
      !table.keys.has(key)
    ) {
      continue;
    }
    if (!isSameType(state.checker, objectType, table.type)) {
      continue;
    }
    if (table.name === 'views' && state.viewArgumentDepth === 0) {
      continue;
    }
    const entry = table.entries.get(key);
    if (entry !== undefined) {
      state.consumed.add(`${table.name} ${entry.key}`);
    }
  }
  return key;
}

/** Whether the literal is a property name, which the object rule (3) decides, not the literal rule (2). */
function isPropertyName(node: typescript.Node): boolean {
  const parent = node.parent;
  return (
    (typescript.isPropertyAssignment(parent) ||
      typescript.isPropertySignature(parent)) &&
    parent.name === node
  );
}

/**
 * A string literal as a table access: a literal whose contextual type names the keys of a table, which is the
 * `valueOf(host, 'defaultExtensions')` case. A literal with no such contextual type, like `const name = 'path'`,
 * is the trap of a text search.
 */
function contextuallyTypedReference(
  state: WalkState,
  node: typescript.StringLiteral | typescript.NoSubstitutionTemplateLiteral,
): void {
  if (isPropertyName(node)) {
    return;
  }
  const context = state.checker.getContextualType(node);
  if (context === undefined) {
    return;
  }
  const members = literalMembersOf(context);
  if (members === undefined) {
    return;
  }
  for (const table of state.tables) {
    if (table.name === 'commands' || table.entries.size === 0) {
      continue;
    }
    if (table.name === 'views' && state.viewArgumentDepth === 0) {
      continue;
    }
    if (!members.every(member => table.keys.has(member))) {
      continue;
    }
    const entry = table.entries.get(node.text);
    if (entry !== undefined) {
      state.consumed.add(`${table.name} ${entry.key}`);
    }
  }
}

/**
 * An object literal as a table access: an object contextually typed over exactly the keys of a
 * table, which maps the table's keys to values.
 */
function objectReference(
  state: WalkState,
  node: typescript.ObjectLiteralExpression,
): void {
  const context = state.checker.getContextualType(node);
  if (context === undefined) {
    return;
  }
  const contextKeys = context.getProperties().map(property => property.name);
  for (const table of state.tables) {
    if (table.name === 'commands' || table.entries.size === 0) {
      continue;
    }
    if (table.name === 'views' && state.viewArgumentDepth === 0) {
      continue;
    }
    if (!sameSet(table.keys, contextKeys)) {
      continue;
    }
    for (const property of node.properties) {
      if (typescript.isSpreadAssignment(property)) {
        continue;
      }
      const name = typescript.isIdentifier(property.name)
        ? property.name.text
        : typescript.isStringLiteral(property.name)
          ? property.name.text
          : undefined;
      if (name !== undefined && table.entries.has(name)) {
        state.consumed.add(`${table.name} ${name}`);
      }
    }
  }
}

/**
 * Whether the identifier is not a use of the table it might type: a name position, a member, a specifier, a type
 * reference, or a third argument of a registerCommands call, which the commands rule decides.
 */
function isWholeTableUse(
  state: WalkState,
  file: typescript.SourceFile,
  node: typescript.Identifier,
): boolean {
  const parent = node.parent;
  if (
    (typescript.isPropertyAssignment(parent) && parent.name === node) ||
    (typescript.isPropertySignature(parent) && parent.name === node) ||
    (typescript.isVariableDeclaration(parent) && parent.name === node) ||
    (typescript.isParameter(parent) && parent.name === node) ||
    (typescript.isFunctionDeclaration(parent) && parent.name === node) ||
    (typescript.isImportSpecifier(parent) &&
      (parent.propertyName === node || parent.name === node)) ||
    (typescript.isExportSpecifier(parent) &&
      (parent.propertyName === node || parent.name === node)) ||
    (typescript.isPropertyAccessExpression(parent) &&
      (parent.expression === node || parent.name === node)) ||
    (typescript.isElementAccessExpression(parent) &&
      parent.expression === node) ||
    parent.kind === typescript.SyntaxKind.TypeQuery ||
    parent.kind === typescript.SyntaxKind.QualifiedName
  ) {
    return false;
  }
  if (state.commandArgumentStarts.has(node.getStart())) {
    return false;
  }
  const start = node.getStart();
  for (const [rangeStart, rangeEnd] of state.passThroughArguments.get(
    file.fileName,
  ) ?? []) {
    if (start >= rangeStart && start < rangeEnd) {
      return false;
    }
  }
  return true;
}

/**
 * The note a whole-table use is: `T` passed as a value, `Object.keys(T)`, `for … of` proves nothing about any one
 * key, so it is a note and consumes no key.
 */
function wholeTableUse(
  state: WalkState,
  file: typescript.SourceFile,
  node: typescript.Identifier,
): void {
  if (!isWholeTableUse(state, file, node)) {
    return;
  }
  const identifierType = state.checker.getTypeAtLocation(node);
  for (const table of state.tables) {
    if (!isSameType(state.checker, identifierType, table.type)) {
      continue;
    }
    const {line} = file.getLineAndCharacterOfPosition(node.getStart());
    state.notes.add(
      `whole table: packages/${state.folder}/${relativeToPackage(
        state.root,
        state.folder,
        file.fileName,
      )}:${String(line + 1)} uses ${table.name}`,
    );
  }
}

/** The keys a registerCommands call carries, and the type parameter that can't be resolved, if any. */
interface CarriedCommands {
  readonly keys: readonly string[];
  readonly unresolved: typescript.Type | undefined;
}

/**
 * The keys the type of the third argument carries: the property names of every constituent of its union. A
 * constituent that is a type parameter is resolved by the one-level pass-through; when it can't be resolved, it
 * is named in `unresolved`.
 */
function carriedCommands(
  state: WalkState,
  argument: typescript.Expression,
): CarriedCommands {
  const argumentType = state.checker.getTypeAtLocation(argument);
  const constituents = argumentType.isUnion()
    ? argumentType.types
    : [argumentType];
  const keys = new Set<string>();
  let unresolved: typescript.Type | undefined;
  for (const constituent of constituents) {
    const flags = constituent.flags;
    if (flags & typescript.TypeFlags.Any) {
      continue;
    }
    if ((flags & typescript.TypeFlags.TypeParameter) !== 0) {
      const passed = passThroughKeys(state, argument, constituent);
      if (passed === undefined) {
        unresolved = constituent;
      } else {
        for (const key of passed) {
          keys.add(key);
        }
      }
    } else {
      for (const property of constituent.getProperties()) {
        keys.add(property.name);
      }
    }
  }
  return {keys: [...keys], unresolved};
}

/**
 * The function a type parameter is carried by: the nearest enclosing function in which a declared parameter's
 * type reaches the type parameter through a property path, walking out from the argument.
 */
/** What the pass-through resolution reads from the walk state: the checker, and the production files it searches. */
interface PassThroughState {
  readonly checker: typescript.TypeChecker;
  readonly productionFiles: readonly typescript.SourceFile[];
}

interface DeclaringFunction {
  readonly node: typescript.SignatureDeclaration;
  readonly argumentIndex: number;
  readonly propertyPath: readonly string[];
}

function declaringFunctionOf(
  state: PassThroughState,
  argument: typescript.Expression,
  parameter: typescript.Type,
): DeclaringFunction | undefined {
  const sourceFile = argument.getSourceFile();
  let node: typescript.Node = argument.parent;
  while (node !== sourceFile) {
    if (typescript.isFunctionLike(node)) {
      let argumentIndex = 0;
      for (const declaredParameter of node.parameters) {
        const name = declaredParameter.name;
        if (typescript.isIdentifier(name)) {
          const propertyPath = propertyPathToTypeParameter(
            state.checker,
            state.checker.getTypeAtLocation(name),
            parameter,
            new Set<typescript.Type>(),
            name,
          );
          if (propertyPath !== undefined) {
            return {node, argumentIndex, propertyPath};
          }
        }
        argumentIndex += 1;
      }
    }
    node = node.parent;
  }
  return undefined;
}

/**
 * The property path from the type to the type parameter it carries: a direct property at every level, or [] when
 * the type is the parameter. A visited type is never revisited, so a cyclic type can't run the search on.
 */
function propertyPathToTypeParameter(
  checker: typescript.TypeChecker,
  type: typescript.Type,
  target: typescript.Type,
  visited: Set<typescript.Type>,
  location: typescript.Node,
): readonly string[] | undefined {
  if (isSameType(checker, type, target)) {
    return [];
  }
  if (visited.has(type)) {
    return undefined;
  }
  visited.add(type);
  for (const property of type.getProperties()) {
    const propertyType = checker.getTypeOfSymbolAtLocation(property, location);
    const rest = propertyPathToTypeParameter(
      checker,
      propertyType,
      target,
      visited,
      location,
    );
    if (rest !== undefined) {
      return [property.name, ...rest];
    }
  }
  return undefined;
}

/** The production call sites of one function, matched by the resolved signature's declaration. */
function declaringCallSites(
  state: PassThroughState,
  node: typescript.SignatureDeclaration,
): readonly typescript.CallExpression[] {
  const sites: typescript.CallExpression[] = [];
  for (const file of state.productionFiles) {
    (function visit(candidate: typescript.Node): void {
      if (typescript.isCallExpression(candidate)) {
        const signature = state.checker.getResolvedSignature(candidate);
        if (signature?.getDeclaration() === node) {
          sites.push(candidate);
        }
      }
      typescript.forEachChild(candidate, visit);
    })(file);
  }
  return sites;
}

/**
 * The keys one call site carries: the property names of the type argument for the declaring parameter, following
 * the property path. Undefined when the argument is missing, the path leads nowhere, or the type argument is
 * itself a type parameter (one level only).
 */
function carriedAtCallSite(
  state: PassThroughState,
  site: typescript.CallExpression,
  declaring: DeclaringFunction,
): readonly string[] | undefined {
  const argument = site.arguments[declaring.argumentIndex];
  if (argument === undefined) {
    return undefined;
  }
  let type = state.checker.getTypeAtLocation(argument);
  for (const property of declaring.propertyPath) {
    const symbol = type.getProperty(property);
    if (symbol === undefined) {
      return undefined;
    }
    type = state.checker.getTypeOfSymbolAtLocation(symbol, argument);
  }
  if ((type.flags & typescript.TypeFlags.TypeParameter) !== 0) {
    return undefined;
  }
  return type.getProperties().map(property => property.name);
}

/**
 * The one-level pass-through: the type of the third argument is a type parameter, so its keys come from the type
 * argument at the declaring function's production call sites. No declaring function, no call site, or an
 * unresolvable call site, makes the parameter unresolvable.
 */
function passThroughKeys(
  state: PassThroughState,
  argument: typescript.Expression,
  parameter: typescript.Type,
): readonly string[] | undefined {
  const declaring = declaringFunctionOf(state, argument, parameter);
  if (declaring === undefined) {
    return undefined;
  }
  const sites = declaringCallSites(state, declaring.node);
  if (sites.length === 0) {
    return undefined;
  }
  const keys = new Set<string>();
  for (const site of sites) {
    const carried = carriedAtCallSite(state, site, declaring);
    if (carried === undefined) {
      return undefined;
    }
    for (const key of carried) {
      keys.add(key);
    }
  }
  return [...keys];
}

/**
 * The commands a registerCommands call consumes: the keys of the package's commands table that are property names
 * of the checker's type of the third argument. A type parameter the pass-through can't resolve is a problem line,
 * never a pass.
 */
function registerCommandsCall(
  state: WalkState,
  file: typescript.SourceFile,
  node: typescript.CallExpression,
): void {
  const thirdArgument = node.arguments[2];
  if (thirdArgument === undefined) {
    return;
  }
  const carried = carriedCommands(state, thirdArgument);
  for (const table of state.tables) {
    if (table.name !== 'commands') {
      continue;
    }
    for (const entry of table.entries.values()) {
      if (carried.keys.includes(entry.key)) {
        state.consumed.add(`commands ${entry.key}`);
      }
    }
  }
  if (carried.unresolved !== undefined) {
    const {line} = file.getLineAndCharacterOfPosition(node.getStart());
    state.commandProblems.add(
      `${relativeToPackage(state.root, state.folder, file.fileName)}:${String(line + 1)}: the commands of this registerCommands call can't be seen (type parameter ${state.checker.typeToString(
        carried.unresolved,
      )})`,
    );
  }
}

/**
 * A `serve({commandId: …})` call: the served internal command its commandId's string literal type names is
 * consumed, whatever table that id comes from. The id is matched as a literal type, so a widened `string` matches
 * nothing.
 */
function serveCall(state: WalkState, node: typescript.CallExpression): void {
  const first = node.arguments[0];
  if (first === undefined || !typescript.isObjectLiteralExpression(first)) {
    return;
  }
  for (const property of first.properties) {
    if (
      !typescript.isPropertyAssignment(property) ||
      property.name.getText() !== 'commandId'
    ) {
      continue;
    }
    const argumentType = state.checker.getTypeAtLocation(property.initializer);
    const constituents = argumentType.isUnion()
      ? argumentType.types
      : [argumentType];
    for (const constituent of constituents) {
      if (!constituent.isStringLiteral()) {
        continue;
      }
      const commandId = constituent.value;
      for (const table of state.tables) {
        if (table.name !== 'internalCommands') {
          continue;
        }
        for (const entry of table.entries.values()) {
          if (entry.id === commandId) {
            state.consumed.add(`internalCommands ${entry.key}`);
          }
        }
      }
    }
  }
}

/**
 * The call-site arguments a resolvable pass-through counts the keys of, by file: a whole-table use inside one is
 * consumed by the registerCommands call it feeds, and gets no whole-table note. An unresolvable pass-through names
 * its problem line, and no argument of it is covered.
 */
function passThroughArgumentsOf(
  files: readonly typescript.SourceFile[],
  checker: typescript.TypeChecker,
): ReadonlyMap<string, ReadonlyArray<readonly [number, number]>> {
  const ranges = new Map<string, Array<[number, number]>>();
  const state: PassThroughState = {checker, productionFiles: files};
  for (const file of files) {
    (function visit(node: typescript.Node): void {
      if (
        typescript.isCallExpression(node) &&
        callName(node.expression) === REGISTER_COMMANDS
      ) {
        const thirdArgument = node.arguments[2];
        if (thirdArgument !== undefined) {
          const argumentType = checker.getTypeAtLocation(thirdArgument);
          const constituents = argumentType.isUnion()
            ? argumentType.types
            : [argumentType];
          for (const constituent of constituents) {
            if (
              (constituent.flags & typescript.TypeFlags.TypeParameter) ===
              0
            ) {
              continue;
            }
            for (const [fileName, start, end] of passThroughArgumentRanges(
              state,
              thirdArgument,
              constituent,
            )) {
              const perFile = ranges.get(fileName) ?? [];
              perFile.push([start, end]);
              ranges.set(fileName, perFile);
            }
          }
        }
      }
      typescript.forEachChild(node, visit);
    })(file);
  }
  return ranges;
}

/**
 * The ranges of the table uses one resolvable pass-through counts the keys of: at each of the declaring function's
 * production call sites, the part of the argument the property path reaches. The rest of the argument, and a table
 * use it doesn't reach, keeps its own note.
 */
function passThroughArgumentRanges(
  state: PassThroughState,
  argument: typescript.Expression,
  parameter: typescript.Type,
): ReadonlyArray<readonly [string, number, number]> {
  const declaring = declaringFunctionOf(state, argument, parameter);
  if (declaring === undefined) {
    return [];
  }
  const sites = declaringCallSites(state, declaring.node);
  // The call-site arguments that carry the table; a site without one, or with a type check that fails, covers nothing.
  const carriedArguments: typescript.Expression[] = [];
  for (const site of sites) {
    const siteArgument = site.arguments[declaring.argumentIndex];
    if (siteArgument === undefined) {
      return [];
    }
    if (carriedAtCallSite(state, site, declaring) === undefined) {
      return [];
    }
    carriedArguments.push(siteArgument);
  }
  const ranges: Array<[string, number, number]> = [];
  for (const siteArgument of carriedArguments) {
    const reached = argumentOfPropertyPath(
      siteArgument,
      declaring.propertyPath,
    );
    if (reached === undefined) {
      continue;
    }
    ranges.push([
      reached.getSourceFile().fileName,
      reached.getStart(),
      reached.getEnd(),
    ]);
  }
  return ranges;
}

/**
 * The part of the argument the property path reaches: the value of the last property the path names, descending
 * through object literals and member accesses. Undefined when the argument's shape doesn't name the path, so no
 * range is covered.
 */
function argumentOfPropertyPath(
  argument: typescript.Expression,
  propertyPath: readonly string[],
): typescript.Expression | undefined {
  let current = argument;
  for (const property of propertyPath) {
    if (typescript.isObjectLiteralExpression(current)) {
      let value: typescript.Expression | undefined;
      for (const node of current.properties) {
        if (
          typescript.isShorthandPropertyAssignment(node) &&
          node.name.text === property
        ) {
          value = node.name;
        } else if (
          typescript.isPropertyAssignment(node) &&
          node.name.getText() === property
        ) {
          value = node.initializer;
        }
      }
      if (value === undefined) {
        return undefined;
      }
      current = value;
    } else if (typescript.isPropertyAccessExpression(current)) {
      if (current.name.text !== property) {
        return undefined;
      }
      current = current.expression;
    } else {
      return undefined;
    }
  }
  return current;
}

/** The starts of the third arguments of every registerCommands call, which the note rule leaves to the commands rule. */
function commandArgumentStartsOf(
  file: typescript.SourceFile,
): ReadonlySet<number> {
  const starts = new Set<number>();
  (function walk(node: typescript.Node): void {
    if (
      typescript.isCallExpression(node) &&
      callName(node.expression) === REGISTER_COMMANDS
    ) {
      const thirdArgument = node.arguments[2];
      if (thirdArgument !== undefined) {
        starts.add(thirdArgument.getStart());
      }
    }
    typescript.forEachChild(node, walk);
  })(file);
  return starts;
}

/** The walk over one node: the call rules, the access rules, and the children. */
function walkNode(
  state: WalkState,
  file: typescript.SourceFile,
  node: typescript.Node,
): void {
  if (typescript.isCallExpression(node)) {
    const name = callName(node.expression);
    if (name !== undefined && VIEW_REGISTRATIONS.has(name)) {
      walkNode(state, file, node.expression);
      const depth = state.viewArgumentDepth;
      for (const argument of node.arguments) {
        state.viewArgumentDepth = depth + 1;
        walkNode(state, file, argument);
        state.viewArgumentDepth = depth;
      }
      return;
    }
    if (name === REGISTER_COMMANDS) {
      registerCommandsCall(state, file, node);
    }
    if (name === 'serve') {
      serveCall(state, node);
    }
  }
  if (
    typescript.isPropertyAccessExpression(node) ||
    typescript.isElementAccessExpression(node)
  ) {
    referenceKeyOf(state, node);
  } else if (
    typescript.isStringLiteral(node) ||
    typescript.isNoSubstitutionTemplateLiteral(node)
  ) {
    contextuallyTypedReference(state, node);
  } else if (typescript.isObjectLiteralExpression(node)) {
    objectReference(state, node);
  } else if (typescript.isIdentifier(node)) {
    wholeTableUse(state, file, node);
  }
  typescript.forEachChild(node, child => {
    walkNode(state, file, child);
  });
}

/**
 * The §3.2 analysis over one package: builds its program, walks every production source, and returns the checked
 * entries, the consumed keys, the whole-table notes, and the registerCommands problem lines.
 */
function consumptionOf(root: string, folder: string): PackageConsumption {
  const program = buildPackageProgram(root, folder);
  const checker = program.getTypeChecker();
  const tables = tablesOf(program, checker, root, folder);
  const files = productionFiles(program, root, folder);
  const consumed = new Set<string>();
  const notes = new Set<string>();
  const commandProblems = new Set<string>();
  const passThroughArguments = passThroughArgumentsOf(files, checker);
  for (const file of files) {
    const state: WalkState = {
      root,
      folder,
      checker,
      tables,
      productionFiles: files,
      commandArgumentStarts: commandArgumentStartsOf(file),
      passThroughArguments,
      consumed,
      notes,
      commandProblems,
      viewArgumentDepth: 0,
    };
    walkNode(state, file, file);
  }
  // The stand-down key is set by lib-standdown from the standDown table's contextKey, so the matching contextKeys
  // entry is consumed even though no production source references it by name.
  const standDown = tables.find(table => table.name === 'standDown');
  if (standDown?.contextKey !== undefined) {
    for (const table of tables) {
      if (table.name !== 'contextKeys') {
        continue;
      }
      for (const entry of table.entries.values()) {
        if (entry.id === standDown.contextKey) {
          consumed.add(`contextKeys ${entry.key}`);
        }
      }
    }
  }
  const entries = new Map<string, TableEntry>();
  for (const table of tables) {
    for (const entry of table.entries.values()) {
      entries.set(`${table.name} ${entry.key}`, entry);
    }
  }
  return {
    folder,
    entries,
    consumed,
    notes: [...notes].sort(),
    commandProblems: [...commandProblems].sort(),
  };
}

/** The knip binary, from the package the tools depend on. */
function knipBinary(): string {
  const entry = fileURLToPath(import.meta.resolve('knip'));
  return path.join(path.dirname(path.dirname(entry)), 'bin', 'knip.js');
}

/** The production-mode knip run from the repository root; the findings are a non-zero exit, not a failure. */
function runProductionKnip(root: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [knipBinary(), '--production', '--no-progress', '--reporter', 'json'],
      {cwd: root},
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', () => {
      resolve(output);
    });
  });
}

/**
 * The unused files under `packages/<x>/src/`, other than `src/testing/**`, of a knip production run, or undefined
 * when the output is not the expected JSON. The export-level categories (exports, types, …) are not this check's:
 * `pnpm dead` owns them.
 */
function unusedModulesOf(output: string): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const issues = (parsed as {issues?: unknown}).issues;
  if (!Array.isArray(issues)) {
    return undefined;
  }
  const modules: string[] = [];
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) {
      return undefined;
    }
    const files = (issue as {files?: unknown}).files;
    if (files === undefined) {
      continue;
    }
    if (!Array.isArray(files)) {
      return undefined;
    }
    for (const file of files) {
      if (typeof file !== 'object' || file === null || Array.isArray(file)) {
        return undefined;
      }
      const name = (file as {name?: unknown}).name;
      if (typeof name !== 'string') {
        return undefined;
      }
      // src/testing/** is test support by convention; R2 excludes it from consumption, and so does the module half.
      if (/^packages\/[^/]+\/src\/testing\//.test(name)) {
        continue;
      }
      if (/^packages\/[^/]+\/src\/[^/]/.test(name)) {
        modules.push(name);
      }
    }
  }
  return modules;
}

/** A problem line with its sort key: the package, the kind, and the key. */
interface SortableLine {
  readonly package: string;
  readonly kind: string;
  readonly key: string;
  readonly line: string;
}

/**
 * The report of §3.4 over the repository: the unconsumed entries and modules, the registerCommands problem lines,
 * the stale and the nameless allowlist entries, the release lines, and the notes. The allowlist must be parsed; the
 * knip run is the production mode, unless a stub is passed.
 */
export async function checkConsumption(
  root: string,
  allowlist: readonly AllowlistEntry[],
  options: ConsumptionOptions = {},
): Promise<ConsumptionReport> {
  const release = options.release === true;
  const runKnip =
    options.runKnip ??
    ((packageRoot: string) => runProductionKnip(packageRoot));
  const consumedOf = new Map<string, PackageConsumption>();
  for (const folder of packageFolders(root)) {
    if (!existsSync(path.join(root, 'packages', folder, TABLE_FILE))) {
      continue;
    }
    try {
      consumedOf.set(folder, consumptionOf(root, folder));
    } catch (error) {
      return {problems: [], notes: [], fatal: messageOf(error)};
    }
  }

  const allowlistKeys = new Set(
    allowlist.map(entry => `${entry.package} ${entry.kind} ${entry.key}`),
  );
  const unusedModules = unusedModulesOf(await runKnip(root));

  const problems: string[] = [];
  if (unusedModules === undefined) {
    problems.push('knip output not understood');
  }

  /** The sort of the report lines: by package, kind and key. */
  function sortByKey(left: SortableLine, right: SortableLine): number {
    return left.package === right.package
      ? left.kind === right.kind
        ? left.key < right.key
          ? -1
          : 1
        : left.kind < right.kind
          ? -1
          : 1
      : left.package < right.package
        ? -1
        : 1;
  }

  const unconsumed: SortableLine[] = [];
  for (const [folder, consumption] of consumedOf) {
    for (const [entryKey, entry] of consumption.entries) {
      if (
        consumption.consumed.has(entryKey) ||
        allowlistKeys.has(`${folder} ${entryKey}`)
      ) {
        continue;
      }
      const space = entryKey.indexOf(' ');
      unconsumed.push({
        package: folder,
        kind: entryKey.slice(0, space),
        key: entryKey.slice(space + 1),
        line: `packages/${folder}: ${entryKey} (${entry.id}) is contributed but no production source consumes it`,
      });
    }
  }
  for (const modulePath of unusedModules ?? []) {
    // The run keeps only a package's src/ files, so the match always holds.
    const [, moduleFolder, moduleRelative] =
      /^packages\/([^/]+)\/(src\/[^/].*)$/.exec(modulePath) as unknown as [
        RegExp,
        string,
        string,
      ];
    if (!allowlistKeys.has(`${moduleFolder} module ${moduleRelative}`)) {
      unconsumed.push({
        package: moduleFolder,
        kind: 'module',
        key: moduleRelative,
        line: `packages/${moduleFolder}: module ${moduleRelative} is imported only by tests`,
      });
    }
  }
  unconsumed.sort(sortByKey);
  problems.push(...unconsumed.map(item => item.line));

  const commandLines: SortableLine[] = [];
  for (const [folder, consumption] of consumedOf) {
    for (const problem of consumption.commandProblems) {
      // The problem line is always 'src/...:N: text'; the key takes the path and the line.
      const pathEnd = problem.indexOf(':');
      const lineEnd = problem.indexOf(':', pathEnd + 1);
      commandLines.push({
        package: folder,
        kind: REGISTER_COMMANDS,
        key: `${problem.slice(0, pathEnd)}:${problem.slice(pathEnd + 1, lineEnd)}`,
        line: `packages/${folder}: ${problem}`,
      });
    }
  }
  commandLines.sort(sortByKey);
  problems.push(...commandLines.map(item => item.line));

  const stale: SortableLine[] = [];
  const nameless: SortableLine[] = [];
  const releaseLines: SortableLine[] = [];
  for (const entry of allowlist) {
    const sortKey = {package: entry.package, kind: entry.kind, key: entry.key};
    if (release && entry.decision === undefined) {
      releaseLines.push({
        ...sortKey,
        line: `allowlist: ${entry.package} ${entry.kind} ${entry.key} must be wired before a release (card ${entry.card}, ${entry.slice})`,
      });
    }
    if (entry.kind === 'module') {
      if (!existsSync(path.join(root, 'packages', entry.package, entry.key))) {
        nameless.push({
          ...sortKey,
          line: `allowlist: ${entry.package} module ${entry.key} names nothing`,
        });
        continue;
      }
      if (
        unusedModules !== undefined &&
        !unusedModules.includes(`packages/${entry.package}/${entry.key}`)
      ) {
        stale.push({
          ...sortKey,
          line: `allowlist: ${entry.package} module ${entry.key} is consumed now; remove it (card ${entry.card})`,
        });
      }
      continue;
    }
    const consumption = consumedOf.get(entry.package);
    const entryKey = `${entry.kind} ${entry.key}`;
    if (!consumption?.entries.has(entryKey)) {
      nameless.push({
        ...sortKey,
        line: `allowlist: ${entry.package} ${entry.kind} ${entry.key} names nothing`,
      });
      continue;
    }
    if (consumption.consumed.has(entryKey)) {
      stale.push({
        ...sortKey,
        line: `allowlist: ${entry.package} ${entry.kind} ${entry.key} is consumed now; remove it (card ${entry.card})`,
      });
    }
  }
  stale.sort(sortByKey);
  nameless.sort(sortByKey);
  releaseLines.sort(sortByKey);
  problems.push(...stale.map(item => item.line));
  problems.push(...nameless.map(item => item.line));
  problems.push(...releaseLines.map(item => item.line));

  const notes: string[] = [];
  for (const consumption of consumedOf.values()) {
    notes.push(...consumption.notes);
  }
  return {problems, notes: notes.sort()};
}
