/**
 * @fileoverview translated-strings: the strings a source file translates at run time, read with the TypeScript parser:
 * the string values of a top-level `const` whose name ends in `_TEMPLATES`, the argument of `l10n.t(...)` and of a
 * same-file `translate(...)`, and the template argument of `filled(...)`. An argument that names a constant the file
 * imports is read from the `imported` map the caller gives, so a string held in another file of the package counts
 * where the editor translates it.
 */

import typescript from 'typescript';

/** A string the code translates, and the line it is written on. */
export interface TranslatedString {
  text: string;
  line: number;
}

/** The text of a string literal, or nothing for any other node. */
function literalText(node: typescript.Node | undefined): string | undefined {
  return node !== undefined &&
    (typescript.isStringLiteral(node) ||
      typescript.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** The node without the `as`, `satisfies` and parentheses around it. */
function unwrapped(node: typescript.Expression): typescript.Expression {
  let current = node;
  while (
    typescript.isAsExpression(current) ||
    typescript.isSatisfiesExpression(current) ||
    typescript.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Whether a call's callee is `l10n.t` on any receiver ending in `l10n`. */
function isL10nCall(callee: typescript.Expression): boolean {
  if (
    !typescript.isPropertyAccessExpression(callee) ||
    callee.name.text !== 't'
  ) {
    return false;
  }
  const receiver = callee.expression;
  return (
    (typescript.isIdentifier(receiver) && receiver.text === 'l10n') ||
    (typescript.isPropertyAccessExpression(receiver) &&
      receiver.name.text === 'l10n')
  );
}

/** The top-level string constants of a file, each by the text it holds. */
export function stringConstants(source: string): Map<string, string> {
  const file = typescript.createSourceFile(
    'constants.ts',
    source,
    typescript.ScriptTarget.Latest,
    true,
  );
  const constants = new Map<string, string>();
  for (const statement of file.statements) {
    if (!typescript.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!typescript.isIdentifier(declaration.name)) {
        continue;
      }
      const initializer =
        declaration.initializer === undefined
          ? undefined
          : unwrapped(declaration.initializer);
      const text = literalText(initializer);
      if (text !== undefined) {
        constants.set(declaration.name.text, text);
      }
    }
  }
  return constants;
}

/** For each name a file imports from a value module, the specifier it is imported from. */
export function importedNames(source: string): Map<string, string> {
  const file = typescript.createSourceFile(
    'imports.ts',
    source,
    typescript.ScriptTarget.Latest,
    true,
  );
  const imported = new Map<string, string>();
  for (const statement of file.statements) {
    if (
      !typescript.isImportDeclaration(statement) ||
      statement.importClause === undefined ||
      !typescript.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause.phaseModifier === typescript.SyntaxKind.TypeKeyword) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (clause.name !== undefined) {
      imported.set(clause.name.text, specifier);
    }
    const bindings = clause.namedBindings;
    if (bindings !== undefined && typescript.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) {
          imported.set(element.name.text, specifier);
        }
      }
    }
  }
  return imported;
}

/** The strings a source file translates, in file order; `imported` gives the text of each constant the file imports. */
export function translatedStrings(
  fileName: string,
  source: string,
  imported?: ReadonlyMap<string, string>,
): TranslatedString[] {
  const file = typescript.createSourceFile(
    fileName,
    source,
    typescript.ScriptTarget.Latest,
    true,
  );
  const found: TranslatedString[] = [];
  const constants = stringConstants(source);
  const declared = new Set<string>();

  function record(node: typescript.Node, text: string): void {
    found.push({
      text,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
    });
  }

  for (const statement of file.statements) {
    if (
      typescript.isFunctionDeclaration(statement) &&
      statement.name !== undefined
    ) {
      declared.add(statement.name.text);
    }
    if (!typescript.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!typescript.isIdentifier(declaration.name)) {
        continue;
      }
      const name = declaration.name.text;
      declared.add(name);
      const initializer =
        declaration.initializer === undefined
          ? undefined
          : unwrapped(declaration.initializer);
      if (
        name.endsWith('_TEMPLATES') &&
        initializer !== undefined &&
        typescript.isObjectLiteralExpression(initializer)
      ) {
        for (const property of initializer.properties) {
          if (typescript.isPropertyAssignment(property)) {
            const value = literalText(unwrapped(property.initializer));
            if (value !== undefined) {
              record(property.initializer, value);
            }
          }
        }
      }
    }
  }

  /** The text of an argument: a literal, or an identifier naming a same-file or an imported constant. */
  function argumentText(
    argument: typescript.Expression | undefined,
  ): string | undefined {
    if (argument === undefined) {
      return undefined;
    }
    if (typescript.isIdentifier(argument)) {
      return constants.get(argument.text) ?? imported?.get(argument.text);
    }
    return literalText(argument);
  }

  /** The names of a function's parameters, plain names only. */
  function parametersOf(node: typescript.Node): typescript.Identifier[] {
    if (
      typescript.isFunctionDeclaration(node) ||
      typescript.isFunctionExpression(node) ||
      typescript.isArrowFunction(node)
    ) {
      return node.parameters.flatMap(parameter =>
        typescript.isIdentifier(parameter.name) ? [parameter.name] : [],
      );
    }
    return [];
  }

  function visit(node: typescript.Node): void {
    for (const parameter of parametersOf(node)) {
      if (parameter.text === 'translate') {
        declared.add('translate');
      }
    }
    if (
      typescript.isFunctionDeclaration(node) &&
      node.name?.text === 'translate'
    ) {
      declared.add('translate');
    }
    if (typescript.isCallExpression(node)) {
      const callee = node.expression;
      const translating =
        isL10nCall(callee) ||
        (typescript.isIdentifier(callee) &&
          callee.text === 'translate' &&
          declared.has('translate'));
      const templateArgument = translating
        ? node.arguments[0]
        : typescript.isIdentifier(callee) && callee.text === 'filled'
          ? node.arguments[1]
          : undefined;
      const text = argumentText(templateArgument);
      if (text !== undefined && templateArgument !== undefined) {
        record(templateArgument, text);
      }
    }
    typescript.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
