import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const PACKAGE = path.join(import.meta.dirname, '..', '..');
const ROOT = 'source.config.ssh';
const KEYWORD_SCOPE = 'support.type.property-name.ssh_config';
const VALUE_SCOPE = 'string.quoted.double.ssh_config';
const COMMENT_SCOPE = 'comment.line.hash.azcli';

/** A token as the editor sees it: its text and its inner scope (every token also carries ROOT). */
type Token = [string, string];

async function loadGrammar(): Promise<textmate.IGrammar> {
  const wasm = readFileSync(
    fileURLToPath(import.meta.resolve('vscode-oniguruma/release/onig.wasm')),
  );
  await oniguruma.loadWASM(wasm.buffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: sources => new oniguruma.OnigScanner(sources),
      createOnigString: text => new oniguruma.OnigString(text),
    }),
    loadGrammar: scopeName => {
      const file = path.join(PACKAGE, 'syntaxes', 'ssh_config.tmLanguage.json');
      return Promise.resolve(
        scopeName === ROOT
          ? textmate.parseRawGrammar(readFileSync(file, 'utf8'), file)
          : null,
      );
    },
  });
  const grammar = await registry.loadGrammar(ROOT);
  if (grammar === null) {
    throw new Error('the grammar loads');
  }
  return grammar;
}

describe('grammar (F-4101)', () => {
  let grammar: textmate.IGrammar;

  function tokens(line: string): Token[] {
    const result = grammar.tokenizeLine(line, textmate.INITIAL);
    return result.tokens.map(token => {
      const [outer, inner] = token.scopes;
      if (outer !== ROOT || token.scopes.length !== 2 || inner === undefined) {
        throw new Error(
          `token without one inner scope: ${token.scopes.join(' ')}`,
        );
      }
      return [line.slice(token.startIndex, token.endIndex), inner];
    });
  }

  before(async () => {
    grammar = await loadGrammar();
  });

  const cases: Array<[string, string, Token[]]> = [
    [
      'a keyword and its value',
      'Port 22',
      [
        ['Port', KEYWORD_SCOPE],
        [' 22', VALUE_SCOPE],
      ],
    ],
    [
      'an indented keyword line',
      '    HostName example.com',
      [
        ['    HostName', KEYWORD_SCOPE],
        [' example.com', VALUE_SCOPE],
      ],
    ],
    ['a keyword alone', 'Host', [['Host', KEYWORD_SCOPE]]],
    ['a glued = (7.E1)', 'Port=22', [['Port=22', KEYWORD_SCOPE]]],
    [
      '= after a space',
      'Port = 22',
      [
        ['Port', KEYWORD_SCOPE],
        [' = 22', VALUE_SCOPE],
      ],
    ],
    [
      '# after the first word (7.E2)',
      'Host x # note',
      [
        ['Host', KEYWORD_SCOPE],
        [' x # note', VALUE_SCOPE],
      ],
    ],
    [
      'quotes and trailing spaces (7.E3)',
      'IdentityFile "a b"  ',
      [
        ['IdentityFile', KEYWORD_SCOPE],
        [' "a b"  ', VALUE_SCOPE],
      ],
    ],
    ['a comment line (BR-4)', '# comment', [['# comment', COMMENT_SCOPE]]],
    ['an indented comment', '  #x', [['  #x', COMMENT_SCOPE]]],
    ['a comment without a space', '####', [['####', COMMENT_SCOPE]]],
    ['a whitespace-only line (BR-5)', '   ', [['   ', VALUE_SCOPE]]],
    ['a tab-only line', '\t', [['\t', VALUE_SCOPE]]],
    [
      '% tokens and variables (BR-9, BR-10)',
      'ControlPath ~/.ssh/cm-%r@%h:%p ${HOME}',
      [
        ['ControlPath', KEYWORD_SCOPE],
        [' ~/.ssh/cm-%r@%h:%p ${HOME}', VALUE_SCOPE],
      ],
    ],
    [
      'an unknown keyword (BR-11)',
      'NotAKeyword value',
      [
        ['NotAKeyword', KEYWORD_SCOPE],
        [' value', VALUE_SCOPE],
      ],
    ],
  ];
  for (const [scenario, line, expected] of cases) {
    it(`tokenizes ${scenario}`, () => {
      deepStrictEqual(tokens(line), expected);
    });
  }

  it('gives an empty line no scoped token (BR-3)', () => {
    deepStrictEqual(
      grammar
        .tokenizeLine('', textmate.INITIAL)
        .tokens.filter(token => token.scopes.length > 1),
      [],
    );
  });

  const whitespace = [
    0x0009, 0x000b, 0x000c, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001,
    0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  ].map(codePoint => String.fromCodePoint(codePoint));

  it('separates the first word at each BR-7 whitespace character', () => {
    deepStrictEqual(
      whitespace.filter(
        character =>
          JSON.stringify(tokens(`Port${character}22`)) !==
          JSON.stringify([
            ['Port', KEYWORD_SCOPE],
            [`${character}22`, VALUE_SCOPE],
          ]),
      ),
      [],
    );
  });

  it('indents a comment with each BR-7 whitespace character', () => {
    deepStrictEqual(
      whitespace.filter(
        character =>
          JSON.stringify(tokens(`${character}# c`)) !==
          JSON.stringify([[`${character}# c`, COMMENT_SCOPE]]),
      ),
      [],
    );
  });

  for (const character of whitespace) {
    const name = `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') ?? ''}`;

    it(`keeps a leading ${name} in the first word (F-4101 AC-27)`, () => {
      deepStrictEqual(tokens(`${character}Port 22`), [
        [`${character}Port`, KEYWORD_SCOPE],
        [' 22', VALUE_SCOPE],
      ]);
    });

    it(`makes a line of ${name} alone one value token (F-4101 AC-35)`, () => {
      deepStrictEqual(tokens(character), [[character, VALUE_SCOPE]]);
    });
  }

  it('keeps zero-width and control characters inside the word (BR-7)', () => {
    deepStrictEqual(
      [
        '\u180E',
        '\u200B',
        '\u2060',
        '\uFEFF',
        '\u0001',
        '\u001F',
        '\u007F',
      ].filter(
        character =>
          JSON.stringify(tokens(`Port${character}22`)) !==
          JSON.stringify([[`Port${character}22`, KEYWORD_SCOPE]]),
      ),
      [],
    );
  });
});
