import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  posixQuote,
  powershellQuote,
  preludeCommand,
  windowsArgument,
} from '../../src/index.ts';

describe('the shell words of a channel (card containers-02)', () => {
  it('contracts: the prelude command reads exactly the script’s bytes and evaluates them', () => {
    deepStrictEqual(
      preludeCommand(42),
      'eval "$(dd bs=1 count=42 2>/dev/null)"',
    );
  });

  it('contracts: a quote makes one word of any text, a single quote written as a closed quote, an escape and an open one', () => {
    deepStrictEqual(
      [posixQuote("it's"), posixQuote('a b'), posixQuote('')],
      [`'it'\\''s'`, "'a b'", "''"],
    );
  });
});

describe('powershellQuote', () => {
  it('ADR-0013: every character PowerShell reads as a single quote is doubled, the apostrophe and U+2018, U+2019, U+201A and U+201B', () => {
    deepStrictEqual(
      ["it's", 'a\u2018b', 'a\u2019b', 'a\u201Ab', 'a\u201Bb', ''].map(value =>
        powershellQuote(value),
      ),
      [
        "'it''s'",
        "'a\u2018\u2018b'",
        "'a\u2019\u2019b'",
        "'a\u201A\u201Ab'",
        "'a\u201B\u201Bb'",
        "''",
      ],
    );
  });

  it('ADR-0013: a double quote, a dollar sign and a backtick stay as they are, since a single-quoted string expands nothing', () => {
    strictEqual(powershellQuote('"$x`n'), `'"$x\`n'`);
  });
});

describe('windowsArgument', () => {
  it('ADR-0013: a value is one argument in double quotes, its double quotes escaped and the backslashes before them doubled', () => {
    deepStrictEqual(
      [
        'plain',
        'a b',
        'say "hi"',
        'a\\"b',
        'C:\\dir\\',
        'C:\\dir\\file',
        '',
      ].map(value => windowsArgument(value)),
      [
        '"plain"',
        '"a b"',
        '"say \\"hi\\""',
        '"a\\\\\\"b"',
        '"C:\\dir\\\\"',
        '"C:\\dir\\file"',
        '""',
      ],
    );
  });
});
