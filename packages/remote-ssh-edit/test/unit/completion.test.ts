import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  completionEntries,
  isKeywordPosition,
  TUNNEL_TEMPLATE,
} from '../../src/completion.ts';
import {KEYWORDS} from '../../src/keywords.ts';

const SNIPPET = {
  label: 'Configure tunnel',
  documentation: 'Insert a template for configuring a tunnel connection.',
};

describe('keyword position (F-4201 BR-11)', () => {
  const keywordPositions: Array<[string, string]> = [
    ['an empty line', ''],
    ['a whitespace-only line', '  \t '],
    ['inside the first word', 'Ho'],
    ['the end of the first word', 'Port'],
    ['after leading whitespace', '    User'],
    ['after a glued =', 'Port='],
    ['after a line-initial #', '#'],
    ['the end of a word glued to #', '#Host'],
    ['after a leading ideographic space', '\u3000Port'],
    ['after a leading vertical tab', '\u000BPort'],
    ['through a zero-width space', 'Port\u200B22'],
    ['through U+180E', 'Port\u180E'],
    ['through a control character', '\u0001Port'],
  ];
  for (const [scenario, text] of keywordPositions) {
    it(`holds at ${scenario}`, () => {
      strictEqual(isKeywordPosition(text), true);
    });
  }

  const otherPositions: Array<[string, string]> = [
    ['after a space following the first word', 'Port '],
    ['in a value', 'HostName ex'],
    ['in comment text after "# "', '# Ho'],
    ['after a tab following the first word', 'Port\t'],
    ['after a no-break space', 'Port\u00A0'],
    ['after U+FEFF', 'Port\uFEFF'],
    ['after a line separator', 'Port\u2028'],
    ['after a paragraph separator', 'Port\u2029'],
  ];
  for (const [scenario, text] of otherPositions) {
    it(`does not hold ${scenario}`, () => {
      strictEqual(isKeywordPosition(text), false);
    });
  }
});

describe('completion entries (F-4201, F-4202)', () => {
  const entries = completionEntries(SNIPPET);

  it('offers the 95 keywords and the snippet', () => {
    deepStrictEqual(
      [
        entries.length,
        entries.filter(entry => entry.kind === 'property').length,
      ],
      [96, 95],
    );
  });

  it('sorts the snippet to position 17, between CompressionLevel and ConnectionAttempts', () => {
    const sorted = [...entries].sort((left, right) =>
      left.sortText.localeCompare(right.sortText, 'en'),
    );
    deepStrictEqual(
      sorted.slice(16, 19).map(entry => entry.label),
      ['CompressionLevel', 'Configure tunnel', 'ConnectionAttempts'],
    );
  });

  it('gives sort keys that keep the keywords in their listed order', () => {
    const keys = KEYWORDS.map(keyword => keyword.label.toLowerCase());
    deepStrictEqual(
      keys,
      [...keys].sort((left, right) => (left < right ? -1 : 1)),
    );
  });

  it('gives every item a sort key that differs from its label', () => {
    deepStrictEqual(
      entries.filter(entry => entry.sortText === entry.label),
      [],
    );
  });

  it('inserts the tunnel template only for the snippet', () => {
    deepStrictEqual(
      entries
        .filter(entry => entry.snippet !== undefined)
        .map(entry => entry.label),
      ['Configure tunnel'],
    );
  });

  it('writes the template of F-4202 BR-5 with the stops of BR-6', () => {
    strictEqual(
      TUNNEL_TEMPLATE,
      'Host ${1:alias}\n    HostName ${2:hostname}\n    LocalForward ${3:port} ${4:localhost}:${3:port}\n    User ${5:user}',
    );
  });
});

describe('keyword data (F-4201 3.4, BR-3, BR-6)', () => {
  it('holds 95 distinct labels', () => {
    strictEqual(new Set(KEYWORDS.map(keyword => keyword.label)).size, 95);
  });

  it('gives every keyword documentation', () => {
    deepStrictEqual(
      KEYWORDS.filter(keyword => keyword.documentation.trim() === '').map(
        keyword => keyword.label,
      ),
      [],
    );
  });

  it('separates paragraphs by one line feed, never a blank line', () => {
    deepStrictEqual(
      KEYWORDS.filter(keyword => /\n\s*\n|\r/.test(keyword.documentation)).map(
        keyword => keyword.label,
      ),
      [],
    );
  });

  it('keeps the backticks of the reference texts literally', () => {
    strictEqual(
      KEYWORDS.find(
        keyword => keyword.label === 'BatchMode',
      )?.documentation.startsWith(
        "If set to ``yes ,'' passphrase/password querying will be disabled.",
      ),
      true,
    );
  });
});
