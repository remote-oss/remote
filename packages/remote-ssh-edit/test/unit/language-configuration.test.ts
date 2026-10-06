import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';

interface LanguageConfiguration {
  comments: {lineComment?: string; blockComment?: unknown};
  brackets: Array<[string, string]>;
  autoClosingPairs: Array<{open: string; close: string; notIn?: string[]}>;
  surroundingPairs: Array<[string, string]>;
  autoCloseBefore?: string;
  wordPattern?: string;
  folding?: unknown;
  onEnterRules?: unknown;
  indentationRules: {
    increaseIndentPattern: string;
    decreaseIndentPattern: string;
  };
}

// language-configuration.json is the object this interface describes; the tests check each field.
const configuration = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', '..', 'language-configuration.json'),
    'utf8',
  ),
) as LanguageConfiguration;

const opensBlock = new RegExp(
  configuration.indentationRules.increaseIndentPattern,
);
const endsBlock = new RegExp(
  configuration.indentationRules.decreaseIndentPattern,
);

describe('language configuration (F-4102)', () => {
  it('has the line comment # and no block comment (BR-1)', () => {
    deepStrictEqual(configuration.comments, {lineComment: '#'});
  });

  it('pairs (), [] and {} but not <> (BR-7)', () => {
    deepStrictEqual(configuration.brackets, [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]);
  });

  it('auto-closes five pairs without a string or comment restriction (BR-9)', () => {
    deepStrictEqual(
      configuration.autoClosingPairs.map(pair => [
        pair.open,
        pair.close,
        pair.notIn,
      ]),
      [
        ['(', ')', undefined],
        ['[', ']', undefined],
        ['{', '}', undefined],
        ['"', '"', undefined],
        ["'", "'", undefined],
      ],
    );
  });

  it('surrounds with the same five pairs (BR-11)', () => {
    deepStrictEqual(configuration.surroundingPairs, [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
      ['"', '"'],
      ["'", "'"],
    ]);
  });

  it('leaves autoCloseBefore, wordPattern, folding and Enter rules to core (BR-10, BR-11a, BR-18, BR-19)', () => {
    deepStrictEqual(
      [
        configuration.autoCloseBefore,
        configuration.wordPattern,
        configuration.folding,
        configuration.onEnterRules,
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('opens a block after a column-1 "Host " line (BR-12)', () => {
    deepStrictEqual(
      [
        'Host alpha',
        'Host *',
        'Host a # c',
        'Host  two',
        'Host ',
        'Host alpha ',
      ].filter(line => !opensBlock.test(line)),
      [],
    );
  });

  it('opens no block on other lines (BR-13)', () => {
    deepStrictEqual(
      [
        'Host',
        'Host\talpha',
        'host a',
        'HOST a',
        'Host=a',
        'Hostx a',
        'Hostname a',
        'Match all',
        '    Host a',
        '# Host a',
        'Host\u00A0nb',
        'Host\u000Cff',
      ].filter(line => opensBlock.test(line)),
      [],
    );
  });

  it('outdents a whitespace-only remainder but not an empty one (BR-14)', () => {
    strictEqual(
      ['   ', '\t'].every(text => endsBlock.test(text)) && !endsBlock.test(''),
      true,
    );
  });
});
