/**
 * @fileoverview ESLint rule for the scoped name exceptions of ADR-0003 that `id-length` cannot express: `i`, `j`
 * and `k` only as variables of a `for` statement of at most five lines, `id` only as a property name, a single
 * upper-case letter only as a type parameter, and a type parameter only as `T`, `K`, `V` or a name of four
 * characters or more (`id-length` does not check type parameters).
 */

import type {Rule, Scope} from 'eslint';

const LOOP_INDICES = new Set(['i', 'j', 'k']);
const LONGEST_LOOP_LINES = 5;
const TYPE_LETTERS = new Set(['T', 'K', 'V']);
const SHORTEST_NAME = 4;

function isShortLoopVariable(definition: Scope.Definition): boolean {
  const declaration = definition.parent as Rule.Node | null;
  const loop = declaration?.parent;
  if (definition.type !== 'Variable' || loop?.type !== 'ForStatement') {
    return false;
  }
  const lines = (loop.loc?.end.line ?? 0) - (loop.loc?.start.line ?? 0) + 1;
  return loop.init === declaration && lines <= LONGEST_LOOP_LINES;
}

function isTypeParameter(definition: Scope.Definition): boolean {
  return (
    (definition.type as string) === 'Type' &&
    definition.node.type === ('TSTypeParameter' as string)
  );
}

function allScopes(scope: Scope.Scope): Scope.Scope[] {
  return [scope, ...scope.childScopes.flatMap(allScopes)];
}

const scopedExceptions: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Restrict the short-name exceptions of ADR-0003 to their scopes',
    },
    schema: [],
    messages: {
      loopIndex:
        "'{{name}}' is allowed only as a variable of a for statement of at most five lines.",
      idBinding:
        "'id' is allowed only as a property name; name the variable for what it identifies.",
      typeLetter: "'{{name}}' is allowed only as a type parameter.",
      typeParameter:
        "Type parameter '{{name}}' must be T, K, V or a name of at least four characters.",
    },
  },
  create(context) {
    // typescript-eslint's TSTypeParameter is not in ESLint's listener map, so its handler is typed by hand.
    const typeParameterListener: Record<string, (node: never) => void> = {
      TSTypeParameter(node: Rule.Node & {name: {name: string}}) {
        const {name} = node.name;
        if (!TYPE_LETTERS.has(name) && name.length < SHORTEST_NAME) {
          context.report({node, messageId: 'typeParameter', data: {name}});
        }
      },
    };
    return {
      ...typeParameterListener,
      'Program:exit'(program) {
        for (const scope of allScopes(context.sourceCode.getScope(program))) {
          for (const variable of scope.variables) {
            const {name, defs: definitions} = variable;
            const node = definitions[0]?.name;
            if (node === undefined) {
              continue;
            }
            if (
              LOOP_INDICES.has(name) &&
              !definitions.every(isShortLoopVariable)
            ) {
              context.report({node, messageId: 'loopIndex', data: {name}});
            } else if (name === 'id') {
              context.report({node, messageId: 'idBinding'});
            } else if (
              /^[A-Z]$/.test(name) &&
              !definitions.every(isTypeParameter)
            ) {
              context.report({node, messageId: 'typeLetter', data: {name}});
            }
          }
        }
      },
    };
  },
};

/** The `names` plugin: `scoped-exceptions`. */
export const namesPlugin = {
  meta: {name: 'names'},
  rules: {'scoped-exceptions': scopedExceptions},
};
