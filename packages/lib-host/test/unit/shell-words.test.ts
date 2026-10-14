import {deepStrictEqual} from 'node:assert';
import {posixQuote, preludeCommand} from '../../src/index.ts';

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
