/**
 * @fileoverview translated-strings: the strings a source file translates at run time, read with the TypeScript parser:
 * the string values of a top-level `const` whose name ends in `_TEMPLATES`, the argument of `l10n.t(...)` and of a
 * same-file `translate(...)`, and the template argument of `filled(...)`.
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

/** The strings a source file translates, in file order. */
export function translatedStrings(
  fileName: string,
  source: string,
): TranslatedString[] {
  const file = typescript.createSourceFile(
    fileName,
    source,
    typescript.ScriptTarget.Latest,
    true,
  );
  const found: TranslatedString[] = [];
  const constants = new Map<string, string>();
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
      const text = literalText(initializer);
      if (text !== undefined) {
        constants.set(name, text);
      }
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

  /** The text of an argument: a literal, or an identifier naming a same-file constant string. */
  function argumentText(
    argument: typescript.Expression | undefined,
  ): string | undefined {
    if (argument === undefined) {
      return undefined;
    }
    return (
      literalText(argument) ??
      (typescript.isIdentifier(argument)
        ? constants.get(argument.text)
        : undefined)
    );
  }

  function visit(node: typescript.Node): void {
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
