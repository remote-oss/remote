import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  ACTIVE_LICENCE_RULES,
  classifyLicence,
  type LicenceFacts,
} from '../../src/index.ts';

const VSCODE = {
  serverLicenseEmpty: false,
  updateUrl: 'https://update.code.visualstudio.com',
};
const VSCODIUM = {serverLicenseEmpty: true, updateUrl: ''};

describe('classifyLicence (F-3902 rule 11, R-80)', () => {
  it('has sourceBased as the only active rule', () => {
    deepStrictEqual(ACTIVE_LICENCE_RULES, ['sourceBased']);
  });

  const licensed: Array<[string, LicenceFacts]> = [
    [
      'a download from the update service on any editor (rule 11 (i), F-3902.AC-14)',
      {
        ...VSCODIUM,
        step: 'override',
        downloadUrl:
          'https://update.code.visualstudio.com/commit:c/server-linux-x64/stable',
      },
    ],
    [
      'a download from the second licence host',
      {
        ...VSCODIUM,
        step: 'override',
        downloadUrl: 'https://vscode.download.prss.microsoft.com/server.tar.gz',
      },
    ],
    [
      "a download from the host of the editor's own updateUrl",
      {
        serverLicenseEmpty: true,
        updateUrl: 'https://updates.fixture.invalid/api',
        step: 'productTemplate',
        downloadUrl: 'https://updates.fixture.invalid/server.tar.gz',
      },
    ],
    [
      'a URL set by the user on an editor with server licence lines (rule 11 (ii), F-3902.AC-12, F-1402.AC-1)',
      {
        ...VSCODE,
        step: 'override',
        downloadUrl: 'https://mirror.example.invalid/server.tar.gz',
      },
    ],
    [
      'the reuse of an installed server on an editor with licence lines (rule 11 (iii), F-3902.AC-10, F-1402.AC-5)',
      {...VSCODE, step: 'reuse'},
    ],
  ];
  for (const [scenario, facts] of licensed) {
    it(`puts under the terms ${scenario}`, () => {
      strictEqual(classifyLicence(facts), true);
    });
  }

  const free: Array<[string, LicenceFacts]> = [
    [
      'a VSCodium release named in the setting of VS Code (F-3902.AC-15)',
      {
        ...VSCODE,
        step: 'override',
        downloadUrl:
          'https://github.com/VSCodium/vscodium/releases/download/1.135.06055/x.tar.gz',
      },
    ],
    [
      'a VSCodium insiders release named in the setting of VS Code',
      {
        ...VSCODE,
        step: 'override',
        downloadUrl:
          'https://github.com/VSCodium/vscodium-insiders/releases/download/x/y.tar.gz',
      },
    ],
    [
      'the built-in VSCodium entry (F-1402.AC-4)',
      {
        ...VSCODIUM,
        step: 'builtInTable',
        downloadUrl:
          'https://github.com/VSCodium/vscodium/releases/download/1/x.tar.gz',
      },
    ],
    [
      'the product template of an editor without licence lines',
      {
        ...VSCODIUM,
        step: 'productTemplate',
        downloadUrl:
          'https://github.com/VSCodium/vscodium/releases/download/1/x.tar.gz',
      },
    ],
    [
      'the reuse of a server on an editor without licence lines',
      {...VSCODIUM, step: 'reuse'},
    ],
    [
      'a download URL that is not a URL',
      {...VSCODIUM, step: 'override', downloadUrl: 'not a url'},
    ],
  ];
  for (const [scenario, facts] of free) {
    it(`leaves free ${scenario}`, () => {
      strictEqual(classifyLicence(facts), false);
    });
  }

  it('applies the inactive clientLicence rule only when asked', () => {
    strictEqual(
      classifyLicence(
        {
          ...VSCODE,
          step: 'override',
          downloadUrl:
            'https://github.com/VSCodium/vscodium/releases/download/1/x.tar.gz',
        },
        ['clientLicence'],
      ),
      true,
    );
  });
});
