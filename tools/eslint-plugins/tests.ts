/**
 * @fileoverview ESLint rule for the test standard of ADR-0003 that a test makes one assertion. The assertions of a
 * test are the calls of `node:assert` functions in its callback, nested callbacks included; a test that needs to
 * check several things puts them in one value and compares it once. Helpers a test calls are not followed.
 */

import type {Rule} from 'eslint';

const TEST_FUNCTIONS = new Set(['it', 'test']);
const ASSERT_MODULES = new Set(['assert', 'strict']);
const ASSERTIONS = new Set([
  'deepEqual',
  'deepStrictEqual',
  'doesNotMatch',
  'doesNotReject',
  'doesNotThrow',
  'equal',
  'fail',
  'ifError',
  'match',
  'notDeepEqual',
  'notDeepStrictEqual',
  'notEqual',
  'notStrictEqual',
  'ok',
  'rejects',
  'strictEqual',
  'throws',
]);
const MAXIMUM_ASSERTIONS = 1;

interface CallNode {
  callee: {
    type: string;
    name?: string;
    object?: {type: string; name?: string; property?: {name?: string}};
    property?: {name?: string};
  };
  arguments: Array<{type: string}>;
}

/** The root name of a callee: `it` for `it(...)` and for `it.only(...)`. */
function rootName(callee: CallNode['callee']): string | undefined {
  return callee.type === 'MemberExpression' ? callee.object?.name : callee.name;
}

/** Whether a call defines a test: `it` or `test`, with a modifier or not, and a function as its last argument. */
function isTestCall(call: CallNode): boolean {
  const last = call.arguments.at(-1);
  return (
    TEST_FUNCTIONS.has(rootName(call.callee) ?? '') &&
    (last?.type === 'ArrowFunctionExpression' ||
      last?.type === 'FunctionExpression')
  );
}

/** Whether a call is an assertion: `strictEqual(...)`, `assert.ok(...)` or `assert.strict.equal(...)`. */
function isAssertion(call: CallNode): boolean {
  const {callee} = call;
  if (callee.type === 'Identifier') {
    return ASSERTIONS.has(callee.name ?? '');
  }
  const owner = callee.object;
  const ownerName =
    owner?.type === 'MemberExpression' ? owner.property?.name : owner?.name;
  return (
    callee.type === 'MemberExpression' &&
    ASSERT_MODULES.has(ownerName ?? '') &&
    ASSERTIONS.has(callee.property?.name ?? '')
  );
}

const oneAssertion: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {description: 'A test makes one assertion.'},
    schema: [],
    messages: {
      tooMany:
        'A test makes one assertion; this one makes {{count}}. Put what it checks in one value and compare that.',
    },
  },
  create(context) {
    const frames: Array<{count: number}> = [];
    return {
      CallExpression(node) {
        const call = node as unknown as CallNode;
        if (isTestCall(call)) {
          frames.push({count: 0});
        } else if (isAssertion(call)) {
          const frame = frames.at(-1);
          if (frame !== undefined) {
            frame.count += 1;
          }
        }
      },
      'CallExpression:exit'(node) {
        if (!isTestCall(node as unknown as CallNode)) {
          return;
        }
        const count = frames.pop()?.count ?? 0;
        if (count > MAXIMUM_ASSERTIONS) {
          context.report({
            node,
            messageId: 'tooMany',
            data: {count: String(count)},
          });
        }
      },
    };
  },
};

/** The `tests` plugin: `one-assertion`. */
export const testsPlugin = {
  meta: {name: 'tests'},
  rules: {'one-assertion': oneAssertion},
};
