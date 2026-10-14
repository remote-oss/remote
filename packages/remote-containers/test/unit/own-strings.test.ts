import {deepStrictEqual, throws} from 'node:assert';
import {ownText} from '../../src/surfaces/own-strings.ts';

describe('the strings of our own (card containers-08)', () => {
  it('F-0503 BR-14(e): the text of noServerSource names the extension and the editor', () => {
    deepStrictEqual(
      ownText(
        'noServerSource',
        ['remote-oss.remote-containers', 'VSCodium'],
        template => template,
      ),
      "remote-oss.remote-containers has no built-in VS Code Server download location for VSCodium. Set remote.serverDownloadBaseUrl to a URL template for this editor's own server builds.",
    );
  });

  it('F-0503 BR-14(e): an id this table lacks throws', () => {
    throws(
      () => ownText('S999', [], template => template),
      /no template for the string id S999/,
    );
  });
});
