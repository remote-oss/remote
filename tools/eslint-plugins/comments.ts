/**
 * @fileoverview ESLint rules for the comment classes of ADR-0003 that the guide's JSDoc rules do not cover:
 * commented-out code, conversational phrases, warning terms without an issue number, and `/* *\/` blocks used for
 * implementation comments.
 */

import type {AST, Rule} from 'eslint';
import tseslint from 'typescript-eslint';

type Comment = AST.Program['comments'][number];

/** A run of comments that a reader sees as one: adjacent line comments, or a single block comment. */
interface CommentGroup {
  first: Comment;
  last: Comment;
  text: string;
}

const CODE_PUNCTUATION = /[;{}()=]|=>/;
const PARAMETER_NAME_COMMENT = /^\s*\w+=\s*$/;
const WARNING_TERM = /\b(TODO|FIXME|XXX|HACK)\b(?!\(#\d+\))/;

function isDocumentation(comment: Comment): boolean {
  return comment.type === 'Block' && comment.value.startsWith('*');
}

function groupComments(comments: Comment[]): CommentGroup[] {
  const groups: CommentGroup[] = [];
  for (const comment of comments) {
    const current = groups.at(-1);
    const continues =
      current?.last.type === 'Line' &&
      comment.type === 'Line' &&
      comment.loc?.start.line === (current.last.loc?.end.line ?? 0) + 1;
    if (continues) {
      current.last = comment;
      current.text += `\n${comment.value}`;
    } else {
      groups.push({first: comment, last: comment, text: comment.value});
    }
  }
  return groups;
}

/** A parsed statement, reduced to the fields that tell code from prose that happens to parse. */
interface ParsedStatement {
  type: string;
  range?: [number, number];
  body?: ParsedStatement | ParsedStatement[];
  expression?: {type: string};
}

// Statements that only code produces; a label, a block or a bare identifier also come out of prose such as
// `(none)` or `Options: {cwd}`.
const CODE_STATEMENTS = new Set([
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'ReturnStatement',
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'ThrowStatement',
  'TryStatement',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
]);
const CODE_EXPRESSIONS = new Set(['AssignmentExpression', 'UpdateExpression']);
const CALL_EXPRESSIONS = new Set([
  'CallExpression',
  'NewExpression',
  'AwaitExpression',
]);

function isCodeStatement(statement: ParsedStatement, text: string): boolean {
  if (CODE_STATEMENTS.has(statement.type)) {
    return true;
  }
  if (statement.body !== undefined) {
    const inner = Array.isArray(statement.body)
      ? statement.body
      : [statement.body];
    return inner.some(child => isCodeStatement(child, text));
  }
  const expression = statement.expression?.type ?? '';
  const source = text.slice(...(statement.range ?? [0, 0]));
  return (
    CODE_EXPRESSIONS.has(expression) ||
    (CALL_EXPRESSIONS.has(expression) && source.trimEnd().endsWith(';'))
  );
}

function parsesAsCode(text: string): boolean {
  if (!CODE_PUNCTUATION.test(text)) {
    return false;
  }
  try {
    const parsed = tseslint.parser.parseForESLint(text);
    // The parser returns an ESTree program with ranges; only its statements' types and ranges are read.
    const statements = (parsed.ast as {body: ParsedStatement[]}).body;
    return statements.some(statement => isCodeStatement(statement, text));
  } catch {
    // A parse error means prose, which is what a comment should hold.
    return false;
  }
}

function locationOf(group: CommentGroup): AST.SourceLocation | undefined {
  const {first, last} = group;
  return first.loc == null || last.loc == null
    ? undefined
    : {start: first.loc.start, end: last.loc.end};
}

const noCommentedOutCode: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {description: 'Disallow comments whose text parses as code'},
    schema: [],
    messages: {
      commentedOut: 'Commented-out code; delete it (version control keeps it).',
    },
  },
  create(context) {
    return {
      Program() {
        const comments = context.sourceCode
          .getAllComments()
          .filter(comment => !isDocumentation(comment))
          .filter(comment => !PARAMETER_NAME_COMMENT.test(comment.value));
        for (const group of groupComments(comments)) {
          const location = locationOf(group);
          const candidates = [group.text, ...group.text.split('\n')];
          if (location !== undefined && candidates.some(parsesAsCode)) {
            context.report({loc: location, messageId: 'commentedOut'});
          }
        }
      },
    };
  },
};

/**
 * Turns a denylist entry into a pattern. An entry with an upper-case letter matches case-sensitively; a trailing
 * `*` makes it a prefix, otherwise it must end at a word boundary.
 */
function phrasePattern(phrase: string): RegExp {
  const prefix = phrase.endsWith('*');
  const body = (prefix ? phrase.slice(0, -1) : phrase).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  const ending = prefix || /\s$/.test(phrase) ? '' : '(?!\\w)';
  const flags = /[A-Z]/.test(phrase) ? '' : 'i';
  return new RegExp(`(?<!\\w)${body}${ending}`, flags);
}

const noConversation: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow phrases that address a reader instead of describing the code',
    },
    schema: [
      {
        type: 'object',
        properties: {phrases: {type: 'array', items: {type: 'string'}}},
        required: ['phrases'],
        additionalProperties: false,
      },
    ],
    messages: {
      conversation:
        "Comment contains '{{phrase}}'; say what the code cannot, without addressing a reader.",
    },
  },
  create(context) {
    const {phrases} = context.options[0] as {phrases: string[]};
    const patterns = phrases.map(phrase => ({
      phrase,
      pattern: phrasePattern(phrase),
    }));
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const found = patterns.find(entry =>
            entry.pattern.test(comment.value),
          );
          if (found !== undefined && comment.loc != null) {
            context.report({
              loc: comment.loc,
              messageId: 'conversation',
              data: {phrase: found.phrase.trim()},
            });
          }
        }
      },
    };
  },
};

// ESLint reads its directives from block comments too.
const DIRECTIVE = /^\s*(eslint|global|exported)\b/;

const lineComments: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `//` for implementation comments; `/* */` only for JSDoc and parameter names',
    },
    schema: [],
    messages: {
      blockComment:
        'Write implementation comments with `//`; `/* */` is for JSDoc and `/* name= */` only.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const isImplementationBlock =
            comment.type === 'Block' &&
            !isDocumentation(comment) &&
            !PARAMETER_NAME_COMMENT.test(comment.value) &&
            !DIRECTIVE.test(comment.value);
          if (isImplementationBlock && comment.loc != null) {
            context.report({loc: comment.loc, messageId: 'blockComment'});
          }
        }
      },
    };
  },
};

const todoIssue: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {description: 'Require an issue number on TODO, FIXME, XXX and HACK'},
    schema: [],
    messages: {
      missingIssue:
        "Write '{{term}}(#123)' with the issue that tracks it, or remove it.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = WARNING_TERM.exec(comment.value);
          if (match?.[1] !== undefined && comment.loc != null) {
            context.report({
              loc: comment.loc,
              messageId: 'missingIssue',
              data: {term: match[1]},
            });
          }
        }
      },
    };
  },
};

/** The `comments` plugin: `line-comments`, `no-commented-out-code`, `no-conversation` and `todo-issue`. */
export const commentsPlugin = {
  meta: {name: 'comments'},
  rules: {
    'line-comments': lineComments,
    'no-commented-out-code': noCommentedOutCode,
    'no-conversation': noConversation,
    'todo-issue': todoIssue,
  },
};
