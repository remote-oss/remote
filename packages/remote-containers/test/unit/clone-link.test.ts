import {deepStrictEqual} from 'node:assert';
import {type LinkReading, linkRequestOf} from '../../src/volumes/clone-link.ts';

/** The reading of an editor answering to `vscode`, whose strict parser rejects only `rejected`. */
function readingOf(rejected = ''): LinkReading {
  return {editorScheme: 'vscode', isUri: text => text !== rejected};
}

/** The request of a link with `path` and the decoded `query`, on `scheme`, whose text is `text`. */
function requestOf(
  path: string,
  query: string,
  {scheme = 'vscode', text = 'the text', reading = readingOf()} = {},
) {
  return linkRequestOf({scheme, path, query, text}, reading);
}

describe('the "Open in Dev Containers" link (card containers-154)', () => {
  it('F-0706 AC-1, AC-8: only the exact path cloneInVolume is ours; any other is ignored', () => {
    deepStrictEqual(
      [
        requestOf('/cloneInVolume', 'url=https://github.com/o/r'),
        requestOf('/CloneInVolume', 'url=https://github.com/o/r'),
        requestOf('/unknownAction', 'url=x'),
        requestOf('', ''),
      ],
      [
        {kind: 'clone', source: 'https://github.com/o/r'},
        {kind: 'ignored'},
        {kind: 'ignored'},
        {kind: 'ignored'},
      ],
    );
  });

  it('F-0706 AC-2, AC-3: no query, no url key, a key of another case, a key with no value and an empty value are all S178', () => {
    deepStrictEqual(
      ['', 'other=1', 'URL=https://github.com/o/r', 'url', 'url='].map(query =>
        requestOf('/cloneInVolume', query),
      ),
      Array(5).fill({kind: 'refused', text: 'S178'}),
    );
  });

  it('F-0706 AC-4, AC-15: the first url is used, as the editor decoded it, spaces and a percent sign included', () => {
    deepStrictEqual(
      [
        requestOf('/cloneInVolume', 'url=a/b&url=c/d'),
        requestOf('/cloneInVolume', 'x=1&url=ftp://h/a b%zz'),
      ],
      [
        {kind: 'clone', source: 'a/b'},
        {kind: 'clone', source: 'ftp://h/a b%zz'},
      ],
    );
  });

  it('decision Q1: a link the strict parser rejects is S210, another scheme is S180, and a control character is S096', () => {
    deepStrictEqual(
      [
        requestOf('/cloneInVolume', 'url=x', {
          text: 'rejected',
          reading: readingOf('rejected'),
        }),
        requestOf('/cloneInVolume', 'url=x', {scheme: 'other'}),
        requestOf('/cloneInVolume', 'url=x', {scheme: 'VSCODE'}),
        requestOf('/cloneInVolume', 'url=a\u0000b'),
        requestOf('/cloneInVolume', 'url=a\u007fb'),
      ],
      [
        {kind: 'refused', text: 'S210'},
        {kind: 'refused', text: 'S180'},
        {kind: 'clone', source: 'x'},
        {kind: 'refused', text: 'S096'},
        {kind: 'refused', text: 'S096'},
      ],
    );
  });
});
