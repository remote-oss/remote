import {deepStrictEqual} from 'node:assert';
import {forbiddenAmong} from './forbidden-texts.ts';

describe('the texts the troubleshooting feature never shows (F-2602 AC-21)', () => {
  it('gives the texts that offer More Info or a search in settings, and no other', () => {
    deepStrictEqual(
      forbiddenAmong([
        'Reload Window',
        'More Info',
        "Search 'remote.SSH.path' in settings",
        'Open Settings',
      ]),
      ['More Info', "Search 'remote.SSH.path' in settings"],
    );
  });

  it('gives none for texts that offer neither', () => {
    deepStrictEqual(forbiddenAmong(['Retry', 'Close Remote']), []);
  });
});
