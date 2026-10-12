import {deepStrictEqual} from 'node:assert';
import {starterTemplate} from '../../src/config/new-file.ts';
import {snippetPartsOf} from '../../src/config/snippet-parts.ts';

describe('snippetPartsOf (the template as text and tab stops, card remote-ssh-19)', () => {
  it('F-2203 BR-6: the four-space template is text around three placeholders and a final stop', () => {
    deepStrictEqual(
      snippetPartsOf(starterTemplate({insertSpaces: true, tabSize: 4})),
      [
        {
          kind: 'text',
          text: '# Read more about SSH config files: https://linux.die.net/man/5/ssh_config\nHost ',
        },
        {kind: 'placeholder', number: 1, text: 'alias'},
        {kind: 'text', text: '\n    HostName '},
        {kind: 'placeholder', number: 2, text: 'hostname'},
        {kind: 'text', text: '\n    User '},
        {kind: 'placeholder', number: 3, text: 'user'},
        {kind: 'final'},
      ],
    );
  });

  it('F-2203 BR-6: the tab-indented template keeps its tabs in the text between the stops', () => {
    deepStrictEqual(
      snippetPartsOf(starterTemplate({insertSpaces: false, tabSize: 2})),
      [
        {
          kind: 'text',
          text: '# Read more about SSH config files: https://linux.die.net/man/5/ssh_config\nHost ',
        },
        {kind: 'placeholder', number: 1, text: 'alias'},
        {kind: 'text', text: '\n\t\tHostName '},
        {kind: 'placeholder', number: 2, text: 'hostname'},
        {kind: 'text', text: '\n\t\tUser '},
        {kind: 'placeholder', number: 3, text: 'user'},
        {kind: 'final'},
      ],
    );
  });

  it('F-2203 BR-6: a template with no tab stops is its text alone', () => {
    deepStrictEqual(snippetPartsOf({text: 'a\nb', tabStops: []}), [
      {kind: 'text', text: 'a\nb'},
    ]);
  });

  it('F-2203 BR-6: a stop at the very start has no text before it', () => {
    deepStrictEqual(
      snippetPartsOf({
        text: 'ab',
        tabStops: [{line: 0, start: 0, end: 2}],
      }),
      [{kind: 'placeholder', number: 1, text: 'ab'}],
    );
  });

  it('F-2203 BR-6: an empty last stop is the final stop, whatever its place', () => {
    deepStrictEqual(
      snippetPartsOf({
        text: 'ab',
        tabStops: [{line: 0, start: 1, end: 1}],
      }),
      [{kind: 'text', text: 'a'}, {kind: 'final'}, {kind: 'text', text: 'b'}],
    );
  });

  it('F-2203 BR-6: an empty stop that is not the last is a numbered stop, since a snippet has one final stop', () => {
    deepStrictEqual(
      snippetPartsOf({
        text: 'abc',
        tabStops: [
          {line: 0, start: 1, end: 1},
          {line: 0, start: 2, end: 3},
        ],
      }),
      [
        {kind: 'text', text: 'a'},
        {kind: 'placeholder', number: 1, text: ''},
        {kind: 'text', text: 'b'},
        {kind: 'placeholder', number: 2, text: 'c'},
      ],
    );
  });
});
