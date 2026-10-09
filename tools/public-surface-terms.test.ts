import {deepStrictEqual} from 'node:assert';
import {forbiddenMatches} from './public-surface-terms.ts';

function termsIn(text: string): string[] {
  return forbiddenMatches(text).map(match => match.term);
}

describe('public-surface terms: words of the process, wherever they appear', () => {
  const FORBIDDEN = [
    'See the card for details.',
    'The conformance suite passes.',
    'An open spec question.',
    'Agreed in the room.',
    'The worker builds it.',
    'Recorded in the lab.',
    'A dirty copy.',
    'A clean-room build.',
    'A clean room build.',
    'It reimplements the extension.',
    'The reimplementation is ours.',
    "Microsoft's extension.",
    'Replaces ms-vscode-remote.remote-ssh.',
    'The orchestrator decides.',
  ];
  for (const text of FORBIDDEN) {
    it(`flags: ${text}`, () => {
      deepStrictEqual(termsIn(text).length > 0, true);
    });
  }

  for (const internalId of ['D-59', 'R-79', 'F-2105', 'F-1402']) {
    it(`flags the internal id ${internalId}`, () => {
      deepStrictEqual(termsIn(`Decided in ${internalId}.`), [internalId]);
    });
  }

  const ALLOWED = [
    'ADR-0003 sets the style.',
    'Uses SHA-256 and UTF-8.',
    'Install a wildcard label for the headroom.',
    'A session over a started process.',
    'Starts a process by its specification.',
    'Holds a reference to the editor.',
  ];
  for (const text of ALLOWED) {
    it(`accepts: ${text}`, () => {
      deepStrictEqual(termsIn(text), []);
    });
  }

  it('flags a bare word that is joined to another by a hyphen', () => {
    deepStrictEqual(termsIn('A card-like layout'), ['card']);
  });
});

describe('public-surface terms: ordinary words, forbidden in the senses of the process only', () => {
  const FORBIDDEN = [
    ['Matches the reference.', 'the reference'],
    ["Like its reference's name.", "reference's"],
    ['Like the reference extension does.', 'the reference'],
    ['A reference implementation.', 'reference implementation'],
    ['See the specification issue.', 'specification issue'],
    ['The published specification says so.', 'published specification'],
    ['Specifications and conformance suite', 'Specifications and conformance'],
    ['In a coding session.', 'coding session'],
    ['An agent sessions log.', 'agent sessions'],
  ] as const;
  for (const [text, term] of FORBIDDEN) {
    it(`flags: ${text}`, () => {
      deepStrictEqual(termsIn(text).includes(term), true);
    });
  }

  it('finds a phrase that wraps over a line end', () => {
    deepStrictEqual(termsIn('as the\nreference does'), ['the reference']);
  });

  it('reports a phrase inside another one once', () => {
    deepStrictEqual(termsIn("The reference's name, like the reference's."), [
      'The reference',
      'the reference',
    ]);
  });

  it('lists the matches in the order they appear', () => {
    deepStrictEqual(termsIn('The worker reads the card.'), ['worker', 'card']);
  });

  it('gives the index of a match', () => {
    deepStrictEqual(
      forbiddenMatches('Ask the worker.').map(match => match.index),
      [8],
    );
  });
});
