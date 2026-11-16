import {deepStrictEqual} from 'node:assert';
import {pseudoLocalize} from './pseudo-locale.ts';

describe('pseudo-locale', () => {
  it('F-0103 AC-3 (c2503-qps-letters): every one of the 22 letters maps to its counterpart, and a letter outside the 22 stands', () => {
    const letters = [
      'A',
      'B',
      'C',
      'D',
      'E',
      'I',
      'L',
      'N',
      'O',
      'S',
      'U',
      'Y',
      'a',
      'b',
      'c',
      'd',
      'e',
      'i',
      'n',
      'o',
      'u',
      'y',
    ];
    const counterparts = [
      'Æ',
      'ß',
      'Ç',
      'Ð',
      'Ë',
      'Ï',
      '£',
      'Ñ',
      'Ø',
      '§',
      'Ü',
      'Ý',
      'æ',
      'þ',
      'ç',
      'ð',
      'ë',
      'ï',
      'ñ',
      'ø',
      'µ',
      'ÿ',
    ];
    deepStrictEqual(
      [letters.map(letter => pseudoLocalize(letter)), pseudoLocalize('Fgzt')],
      [counterparts, 'Fgzt'],
    );
  });

  it('F-0103 AC-3 (c2503-qps-placeholders): a {0}-style placeholder in the text comes through unchanged', () => {
    deepStrictEqual(pseudoLocalize('Item {0} of {1}'), 'Ïtëm {0} øf {1}');
  });

  it('F-0103 AC-3 (c2503-qps-codicon): a $(codicon) token is substituted letter by letter', () => {
    deepStrictEqual(pseudoLocalize('$(gear) Save'), '$(gëær) §ævë');
  });

  it('F-0103 AC-3 (c2503-qps-link): a command:-scheme link has its scheme and command id substituted', () => {
    deepStrictEqual(
      pseudoLocalize('[Open](command:workbench.action.reloadWindow)'),
      '[Øpëñ](çømmæñð:wørkþëñçh.æçtïøñ.rëløæðWïñðøw)',
    );
  });

  it('F-0103 AC-9 (c2503-qps-locked): a locked string is copied byte for byte while the rest is substituted', () => {
    deepStrictEqual(
      pseudoLocalize('Open [the log](command:open.log) now', [
        '](command:open.log)',
      ]),
      'Øpëñ [thë løg](command:open.log) ñøw',
    );
  });

  it('F-0103 AC-9 (c2503-qps-empty): an empty text gives an empty text', () => {
    deepStrictEqual(pseudoLocalize(''), '');
  });
});
