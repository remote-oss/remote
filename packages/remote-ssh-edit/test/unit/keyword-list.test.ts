import {deepStrictEqual, notStrictEqual, strictEqual} from 'node:assert';
import {completionEntries} from '../../src/completion.ts';
import {KEYWORDS} from '../../src/keywords.ts';
import {EXPECTED_ITEMS} from './keyword-list.fixture.ts';

const SNIPPET = {
  label: 'Configure tunnel',
  documentation: 'Insert a template for configuring a tunnel connection.',
};

function documentationOf(label: string): string {
  const keyword = KEYWORDS.find(entry => entry.label === label);
  if (keyword === undefined) {
    throw new Error(`no keyword item '${label}'`);
  }
  return keyword.documentation;
}

describe('keyword list (F-4201 3.4)', () => {
  it('lists the 96 labels in order once the editor sorts by sort key (F-4201 AC-1, AC-24)', () => {
    const sorted = [...completionEntries(SNIPPET)].sort((left, right) =>
      left.sortText < right.sortText ? -1 : 1,
    );
    deepStrictEqual(
      sorted.map(entry => entry.label),
      EXPECTED_ITEMS.map(([label]) => label),
    );
  });

  for (const [label, sentence] of EXPECTED_ITEMS) {
    if (sentence !== null) {
      it(`documents ${label} beginning with its quoted sentence (F-4201 AC-4)`, () => {
        strictEqual(documentationOf(label).slice(0, sentence.length), sentence);
      });
    } else if (label !== SNIPPET.label) {
      it(`documents ${label} with a text of its own (F-4201 AC-4, BR-6)`, () => {
        notStrictEqual(documentationOf(label).trim(), '');
      });
    }
  }
});
