import {deepStrictEqual} from 'node:assert';
import {neutralText} from '../../src/text/neutral-text.ts';

describe('the text neutraliser (wsl.package)', () => {
  it('escapes each bracket and parenthesis with a backslash', () => {
    deepStrictEqual(['[', ']', '(', ')', 'a [b](c) d'].map(neutralText), [
      '\\[',
      '\\]',
      '\\(',
      '\\)',
      'a \\[b\\]\\(c\\) d',
    ]);
  });

  it('escapes the dollar that opens an icon, and leaves a lone dollar', () => {
    deepStrictEqual(['$(gear)', 'cost $5', '$', 'a$'].map(neutralText), [
      '\\$\\(gear\\)',
      'cost $5',
      '$',
      'a$',
    ]);
  });

  it('drops C0 and C1 control characters, and keeps the characters around them', () => {
    deepStrictEqual(
      [
        'a\u0000b',
        'line\nbreak',
        'tab\there',
        'c1\u0085x\u009fy',
        '\u001b[31mred',
      ].map(neutralText),
      ['ab', 'linebreak', 'tabhere', 'c1xy', '\\[31mred'],
    );
  });

  it('gives back a string with none of them unchanged', () => {
    deepStrictEqual(
      neutralText('Ubuntu-24.04 /home/user'),
      'Ubuntu-24.04 /home/user',
    );
  });

  it('escapes an incoming backslash too, so it cannot cancel the escape of the character after it', () => {
    deepStrictEqual(
      neutralText('\\[x\\]\\(https://e\\)'),
      '\\\\\\[x\\\\\\]\\\\\\(https://e\\\\\\)',
    );
  });
});
