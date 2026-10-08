import {deepStrictEqual, match, ok} from 'node:assert';
import {lexConfiguration} from '../../src/config/lexer.ts';

describe('lexConfiguration (the keyword lines of a configuration file)', () => {
  it('F-2202.BR-1: a Host line keeps its keyword and its words', () => {
    deepStrictEqual(lexConfiguration('Host one'), {
      directives: [{keyword: 'Host', words: ['one']}],
    });
  });

  it('F-2202.BR-1: a keyword in any case stays as written', () => {
    deepStrictEqual(lexConfiguration('HOST upperkw'), {
      directives: [{keyword: 'HOST', words: ['upperkw']}],
    });
  });

  const EQ_FORMS = [
    ['Host=eqsyntax', ['eqsyntax']],
    ['Host = eqspace', ['eqspace']],
    ['Host =eqleft', ['eqleft']],
    ['Host= eqright', ['eqright']],
  ] as const;
  for (const [line, words] of EQ_FORMS) {
    it(`F-2202.BR-1: an = form of ${line}`, () => {
      deepStrictEqual(lexConfiguration(line), {
        directives: [{keyword: 'Host', words: [...words]}],
      });
    });
  }

  it('F-2202.BR-1: blanks separate words, however many', () => {
    deepStrictEqual(lexConfiguration('Host two three   four'), {
      directives: [{keyword: 'Host', words: ['two', 'three', 'four']}],
    });
  });

  it('F-2202.BR-1: a tab separates words', () => {
    deepStrictEqual(lexConfiguration('Host tabbed\ttabbed2'), {
      directives: [{keyword: 'Host', words: ['tabbed', 'tabbed2']}],
    });
  });

  it('F-2202.BR-1: an unquoted # ends the line', () => {
    deepStrictEqual(lexConfiguration('Host trailing # a comment'), {
      directives: [{keyword: 'Host', words: ['trailing']}],
    });
  });

  it('F-2202.BR-1: a quoted word keeps its blanks', () => {
    deepStrictEqual(lexConfiguration('Host "quoted name" afterquote'), {
      directives: [{keyword: 'Host', words: ['quoted name', 'afterquote']}],
    });
  });

  it('F-2201.BR-9: comments and blank lines hold no directives', () => {
    deepStrictEqual(
      lexConfiguration('# Host hidden\n\n   # indented\nHost shown'),
      {
        directives: [{keyword: 'Host', words: ['shown']}],
      },
    );
  });

  it('F-2202.BR-18: CRLF line ends', () => {
    deepStrictEqual(lexConfiguration('Host a\r\nHost b\r\n'), {
      directives: [
        {keyword: 'Host', words: ['a']},
        {keyword: 'Host', words: ['b']},
      ],
    });
  });

  it('F-2202.BR-18: a leading byte order mark is ignored', () => {
    deepStrictEqual(lexConfiguration('\uFEFFHost a'), {
      directives: [{keyword: 'Host', words: ['a']}],
    });
  });

  const INCLUDE_FORMS = [
    ['Include=path', 'Include', ['path']],
    ['include "p q"', 'include', ['p q']],
    ['Include a b', 'Include', ['a', 'b']],
  ] as const;
  for (const [line, keyword, words] of INCLUDE_FORMS) {
    it(`F-2202.BR-10: an Include of ${line}`, () => {
      deepStrictEqual(lexConfiguration(line), {
        directives: [{keyword, words: [...words]}],
      });
    });
  }

  const MATCH_FORMS = [
    ['Match host=m13', 'Match', ['host=m13']],
    ['MATCH HOST m14', 'MATCH', ['HOST', 'm14']],
    ['Match host "m3,m4" user bob', 'Match', ['host', 'm3,m4', 'user', 'bob']],
  ] as const;
  for (const [line, keyword, words] of MATCH_FORMS) {
    it(`F-2202.BR-4: a Match of ${line}`, () => {
      deepStrictEqual(lexConfiguration(line), {
        directives: [{keyword, words: [...words]}],
      });
    });
  }

  it('F-2201.7.E1: a quote never closed is a parse error', () => {
    match(
      JSON.stringify(lexConfiguration('Host "abc')),
      /^\{"parseError":".+"\}$/,
    );
  });

  it('F-2201.7.E1: a quote open at a line end is a parse error', () => {
    match(
      JSON.stringify(lexConfiguration('Host "abc\nHost b')),
      /^\{"parseError":".+"\}$/,
    );
  });

  it('F-2201.BR-9: empty text holds no directives', () => {
    deepStrictEqual(lexConfiguration(''), {directives: []});
  });

  it('F-2201.BR-9: a line without a known keyword is still a directive', () => {
    const result = lexConfiguration('garbage line');
    ok('directives' in result);
  });
});
