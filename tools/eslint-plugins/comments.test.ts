import {RuleTester} from 'eslint';
import tseslint from 'typescript-eslint';
import {commentsPlugin} from './comments.ts';

const ruleTester = new RuleTester({languageOptions: {parser: tseslint.parser}});
const {rules} = commentsPlugin;

ruleTester.run('no-commented-out-code', rules['no-commented-out-code'], {
  valid: [
    {
      code: '// Retries once, because the first request after a resume fails.\nrun();',
    },
    {code: '/** Returns the answer (a number). */\nexport const answer = 42;'},
    {code: 'configure(/* enabled= */ true);'},
    {code: '// see check-layout\nrun();'},
    {code: '// (none)\nrun();'},
    {code: '// Options: {cwd}\nrun();'},
    {code: '// e.g. spawn(command)\nrun();'},
  ],
  invalid: [
    {
      code: '// const answer = 42;\nrun();',
      errors: [{messageId: 'commentedOut'}],
    },
    {
      code: '// if (ready) {\n//   start();\n// }\nrun();',
      errors: [{messageId: 'commentedOut'}],
    },
    {
      code: '// Retries once.\n// retry();\nrun();',
      errors: [{messageId: 'commentedOut'}],
    },
    {
      code: '/* start(); */\nrun();',
      errors: [{messageId: 'commentedOut'}],
    },
  ],
});

const phrases = ['note that', 'apolog*', 'just', 'I '];
const options = [{phrases}];

ruleTester.run('no-conversation', rules['no-conversation'], {
  valid: [
    {code: '// Adjusts the interval to the server limit.\nrun();', options},
    {code: '// The justification is in #12.\nrun();', options},
    {code: '// Reads I/O counters.\nrun();', options},
  ],
  invalid: [
    {
      code: '// Note that this retries.\nrun();',
      options,
      errors: [{messageId: 'conversation', data: {phrase: 'note that'}}],
    },
    {
      code: '// Apologies for the workaround.\nrun();',
      options,
      errors: [{messageId: 'conversation', data: {phrase: 'apolog*'}}],
    },
    {
      code: '/** Just returns the answer. */\nexport const answer = 42;',
      options,
      errors: [{messageId: 'conversation', data: {phrase: 'just'}}],
    },
    {
      code: '// Here I check the cache.\nrun();',
      options,
      errors: [{messageId: 'conversation', data: {phrase: 'I'}}],
    },
  ],
});

ruleTester.run('line-comments', rules['line-comments'], {
  valid: [
    {code: '// Retries once.\nrun();'},
    {code: '/** Returns the answer. */\nexport const answer = 42;'},
    {code: 'configure(/* enabled= */ true);'},
    {code: '/* eslint-disable no-console */\nrun();'},
  ],
  invalid: [
    {
      code: 'function start() {\n  /* Retries once. */\n  run();\n}',
      errors: [{messageId: 'blockComment'}],
    },
    {
      code: '/* A file comment. */\nrun();',
      errors: [{messageId: 'blockComment'}],
    },
  ],
});

ruleTester.run('todo-issue', rules['todo-issue'], {
  valid: [
    {code: '// TODO(#123): drop the retry once the server is fixed.\nrun();'},
    {code: '// Lists what is still to do.\nrun();'},
  ],
  invalid: [
    {
      code: '// TODO: drop the retry.\nrun();',
      errors: [{messageId: 'missingIssue', data: {term: 'TODO'}}],
    },
    {
      code: '// HACK(#abc) until the fix.\nrun();',
      errors: [{messageId: 'missingIssue', data: {term: 'HACK'}}],
    },
    {
      code: '/* FIXME */\nrun();',
      errors: [{messageId: 'missingIssue', data: {term: 'FIXME'}}],
    },
  ],
});

ruleTester.run('public-surface', rules['public-surface'], {
  valid: [
    {code: '// Starts a process by its specification.\nrun();'},
    {code: '/** A session over a started process. */\nexport const done = 1;'},
    {code: '// Holds a reference to the editor.\nrun();'},
    {code: 'const worker = 1;\nrun(worker);'},
  ],
  invalid: [
    {
      code: '// Interop with the reference is not a goal.\nrun();',
      errors: [{messageId: 'processWording', data: {term: 'the reference'}}],
    },
    {
      code: '/** Decided in F-2105. */\nexport const done = 1;',
      errors: [{messageId: 'processWording', data: {term: 'F-2105'}}],
    },
    {
      code: '// eslint-disable-next-line no-empty-function -- the card fixes this\nrun();',
      errors: [{messageId: 'processWording', data: {term: 'card'}}],
    },
    {
      code: '// The worker and\n// the card agree.\nrun();',
      errors: [
        {messageId: 'processWording', data: {term: 'worker'}},
        {messageId: 'processWording', data: {term: 'card'}},
      ],
    },
    {
      code: '// as the\n// reference does\nrun();',
      errors: [{messageId: 'processWording', data: {term: 'the reference'}}],
    },
  ],
});
