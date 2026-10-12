import {deepStrictEqual} from 'node:assert';
import {
  allowedRedirectHosts,
  REFERENCE_LAYOUT_APPLICATION_NAMES,
  keepsReferenceLayout,
  volumeServerFolder,
} from '../../src/index.ts';

describe('reference-layout application names (card product-01 table)', () => {
  it('REFERENCE_LAYOUT_APPLICATION_NAMES is the two names, frozen', () => {
    deepStrictEqual(
      [
        REFERENCE_LAYOUT_APPLICATION_NAMES,
        Object.isFrozen(REFERENCE_LAYOUT_APPLICATION_NAMES),
      ],
      [['code', 'code-insiders'], true],
    );
  });

  it("keepsReferenceLayout('code') and ('code-insiders') -> true", () => {
    deepStrictEqual(
      [keepsReferenceLayout('code'), keepsReferenceLayout('code-insiders')],
      [true, true],
    );
  });

  it("keepsReferenceLayout('codium'), ('code-oss'), ('Code') and ('') -> false", () => {
    deepStrictEqual(
      [
        keepsReferenceLayout('codium'),
        keepsReferenceLayout('code-oss'),
        keepsReferenceLayout('Code'),
        keepsReferenceLayout(''),
      ],
      [false, false, false, false],
    );
  });

  it("volumeServerFolder('code') and ('code-insiders') -> the shared folder", () => {
    deepStrictEqual(
      [volumeServerFolder('code'), volumeServerFolder('code-insiders')],
      ['vscode-server', 'vscode-server'],
    );
  });

  it("volumeServerFolder('codium') and ('synthetic-editor') -> the editor's own folder", () => {
    deepStrictEqual(
      [volumeServerFolder('codium'), volumeServerFolder('synthetic-editor')],
      ['codium-server', 'synthetic-editor-server'],
    );
  });
});

describe('the hosts a download may be redirected to', () => {
  it('release assets of github.com come from two other hosts', () => {
    deepStrictEqual(allowedRedirectHosts('github.com'), [
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ]);
  });

  it('the source host is matched in any letter case', () => {
    deepStrictEqual(allowedRedirectHosts('GitHub.com').length, 2);
  });

  it('a source with no entry may not be redirected to another host', () => {
    deepStrictEqual(allowedRedirectHosts('download.example.invalid'), []);
  });
});
