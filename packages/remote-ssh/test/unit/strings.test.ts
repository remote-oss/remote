import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {filled, filledWithRanges} from '../../src/surfaces/strings.ts';

const BUNDLES = path.join(import.meta.dirname, '..', '..', 'l10n');

const WARNING =
  'Remote - SSH stays inactive in this window because another extension that provides SSH remotes is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';
const BUTTON = 'Show Other Extension';

function bundle(file: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(BUNDLES, file), 'utf8')) as Record<
    string,
    string
  >;
}

describe('the runtime strings of the extension', () => {
  it('the stand-down warning and its button are in the default bundle, as written, and every value of the default bundle is its key', () => {
    const texts = bundle('bundle.l10n.json');
    deepStrictEqual(
      [
        texts[WARNING],
        texts[BUTTON],
        Object.entries(texts).filter(([key, text]) => key !== text),
      ],
      [WARNING, BUTTON, []],
    );
  });

  it('the warning names no placeholder and carries no process word', () => {
    deepStrictEqual(
      [
        /\{\d+\}/.test(WARNING),
        /reference|Microsoft|ms-vscode|clean-room|reimplement|\bspec\b|\bsession\b|worker|\blab\b|[FRD]-\d/i.test(
          WARNING + BUTTON,
        ),
      ],
      [false, false],
    );
  });
});

describe('filling a template', () => {
  function same(template: string): string {
    return template;
  }

  it('F-3902 rule 8: a value with $& is inserted as written', () => {
    deepStrictEqual(filled(same, 'Host "{0}"', ['box$&']), 'Host "box$&"');
  });

  it('F-3902 rule 8: a value with $1 is inserted as written', () => {
    deepStrictEqual(filled(same, 'Host "{0}"', ['box$1']), 'Host "box$1"');
  });

  it('F-3902 rule 8: a value with $$ is inserted as written', () => {
    deepStrictEqual(filled(same, 'Host "{0}"', ['a$$b']), 'Host "a$$b"');
  });

  it('F-3902 rule 8: a value with a place in it is not filled again', () => {
    deepStrictEqual(filled(same, '{0} and {1}', ['a{1}', 'b']), 'a{1} and b');
  });

  it('F-3902 rule 8: a place without a value stays as written', () => {
    deepStrictEqual(filled(same, '{0} and {1}', ['a']), 'a and {1}');
  });

  it('F-3902 rule 8: a place that occurs twice is filled twice', () => {
    deepStrictEqual(filled(same, '{0}, again {0}', ['z']), 'z, again z');
  });

  it('F-3902 rule 8: the translation is filled, not the English', () => {
    deepStrictEqual(
      filled(() => 'Hôte {0}', 'Host {0}', ['box']),
      'Hôte box',
    );
  });

  it('F-3902 rule 8: a template without places is returned as translated', () => {
    deepStrictEqual(filled(same, 'no places'), 'no places');
  });
});

describe('a template filled with the places of its values (F-2602 3.4)', () => {
  it('gives the range of each value of a named slot in the filled text, counted in its characters', () => {
    deepStrictEqual(
      filledWithRanges(
        template => template,
        'on {1}, set {0} and {1}',
        ['a', 'bc'],
        [1],
      ),
      {
        text: 'on bc, set a and bc',
        ranges: [
          {start: 3, length: 2},
          {start: 17, length: 2},
        ],
      },
    );
  });

  it('gives no range for a slot that is not named, an empty value, or a place with no value', () => {
    deepStrictEqual(
      filledWithRanges(template => template, '{0}{1}{2}', ['a', ''], [0, 1, 2]),
      {text: 'a{2}', ranges: [{start: 0, length: 1}]},
    );
  });

  it('puts the ranges after the translation, which may move the places', () => {
    deepStrictEqual(
      filledWithRanges(
        template => (template === 'T {0}' ? 'Ein langer Text {0}' : template),
        'T {0}',
        ['key'],
        [0],
      ).ranges,
      [{start: 16, length: 3}],
    );
  });
});
