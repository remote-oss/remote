import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  profileOf,
  readProfile,
  serverDataFolderNameOrDefault,
  type ProductProfile,
} from '../../src/index.ts';
import {fixtureProfile} from './fixture.ts';

describe('readProfile', () => {
  it('reads every field of the synthetic product', () => {
    deepStrictEqual(fixtureProfile('synthetic'), {
      applicationName: 'fixture-editor',
      version: '9.8.7',
      commit: 'f1f2f3f4',
      quality: 'fixture-quality',
      release: '-r7',
      serverApplicationName: 'fixture-server',
      serverDataFolderName: '.fixture-server',
      dataFolderName: '.fixture-editor',
      tunnelApplicationName: 'fixture-tunnel',
      urlProtocol: 'fixture',
      serverDownloadUrlTemplate:
        'https://archives.example.invalid/${quality}/${commit}/${version}${release}/server-${os}-${arch}.tar.gz',
      cliDownloadUrlTemplate: '',
      updateUrl: '',
      downloadUrl: '',
      serverLicense: [],
      serverLicenseUrl: '',
    });
  });

  it('gives a missing release the empty value (F-3902 rule 3)', () => {
    strictEqual(fixtureProfile('vscodium-reduced').release, '');
  });

  it('gives missing fields their empty values and leaves serverDataFolderName absent', () => {
    deepStrictEqual(readProfile('{"applicationName": "fixture-editor"}'), {
      kind: 'profile',
      profile: {
        applicationName: 'fixture-editor',
        version: '',
        commit: '',
        quality: '',
        release: '',
        serverApplicationName: '',
        dataFolderName: '',
        tunnelApplicationName: '',
        urlProtocol: '',
        serverDownloadUrlTemplate: '',
        cliDownloadUrlTemplate: '',
        updateUrl: '',
        downloadUrl: '',
        serverLicense: [],
        serverLicenseUrl: '',
      },
    });
  });

  it('brief §3: reads the CLI download template the product names', () => {
    const reading = readProfile(
      '{"cliDownloadUrlTemplate": "https://x/${version}/cli-${os}-${arch}.tar.gz"}',
    );
    deepStrictEqual(
      reading.kind === 'profile'
        ? reading.profile.cliDownloadUrlTemplate
        : reading,
      'https://x/${version}/cli-${os}-${arch}.tar.gz',
    );
  });

  it('brief §3: gives a product with no CLI template the empty text', () => {
    const reading = readProfile('{}');
    deepStrictEqual(
      reading.kind === 'profile'
        ? reading.profile.cliDownloadUrlTemplate
        : reading,
      '',
    );
  });

  it('brief §3: reports a CLI template that is not a string as unreadable, naming the field', () => {
    deepStrictEqual(readProfile('{"cliDownloadUrlTemplate": 3}'), {
      kind: 'unreadable',
      reason: 'cliDownloadUrlTemplate is not a string',
    });
  });

  it('keeps the gallery the product names', () => {
    deepStrictEqual(fixtureProfile('vscodium-reduced').gallery, {
      serviceUrl: 'https://open-vsx.org/vscode/gallery',
    });
  });

  const unreadable: Array<[string, string]> = [
    ['text that is not JSON', '{'],
    ['JSON that is not an object', '[]'],
    ['a string field of another type', '{"commit": 7}'],
    ['a licence that is not a list of strings', '{"serverLicense": "yes"}'],
    ['a gallery that is not an object', '{"extensionsGallery": []}'],
  ];
  for (const [scenario, text] of unreadable) {
    it(`reports ${scenario} as unreadable`, () => {
      strictEqual(readProfile(text).kind, 'unreadable');
    });
  }
});

describe('serverDataFolderNameOrDefault (card product-02 table)', () => {
  it('keeps the declared folder', () => {
    strictEqual(
      serverDataFolderNameOrDefault({
        serverDataFolderName: '.vscodium-server',
        applicationName: 'codium',
      }),
      '.vscodium-server',
    );
  });

  it('derives the folder from the application name when the field is absent', () => {
    const absent: Pick<
      ProductProfile,
      'serverDataFolderName' | 'applicationName'
    > = {applicationName: 'synthetic-editor'};
    strictEqual(
      serverDataFolderNameOrDefault(absent),
      '.synthetic-editor-server',
    );
  });

  it('counts an empty folder as absent and derives', () => {
    strictEqual(
      serverDataFolderNameOrDefault({
        serverDataFolderName: '',
        applicationName: 'x',
      }),
      '.x-server',
    );
  });

  it('derives for the synthetic fixture without the field; VS Code and VSCodium keep theirs', () => {
    const synthetic = fixtureProfile('synthetic');
    const withoutField: Pick<
      ProductProfile,
      'serverDataFolderName' | 'applicationName'
    > = {applicationName: synthetic.applicationName};
    deepStrictEqual(
      [
        serverDataFolderNameOrDefault(withoutField),
        serverDataFolderNameOrDefault(fixtureProfile('vscode-reduced')),
        serverDataFolderNameOrDefault(fixtureProfile('vscodium-reduced')),
      ],
      ['.fixture-editor-server', '.vscode-server', '.vscodium-server'],
    );
  });

  it('names no product in the function (ADR-0006)', () => {
    const file = readFileSync(
      path.join(import.meta.dirname, '..', '..', 'src', 'profile.ts'),
      'utf8',
    );
    const functionText = file.slice(
      file.indexOf('export function serverDataFolderNameOrDefault'),
    );
    strictEqual(
      /codium|vscodium|vscode-server|code\.visualstudio\.com/i.test(
        functionText,
      ),
      false,
    );
  });
});

describe('profileOf', () => {
  const TEXT = '{"applicationName": "fixture-editor", "version": "1.2.3"}';

  it('lib-product.profile: a readable product.json text gives the profile readProfile gives', () => {
    const reading = readProfile(TEXT);
    deepStrictEqual(
      profileOf(TEXT),
      reading.kind === 'profile' ? reading.profile : undefined,
    );
  });

  it('lib-product.profile: a text that is not JSON throws an error that says product.json cannot be read', () => {
    throws(() => profileOf('not json'), {
      name: 'Error',
      message: /^product\.json cannot be read: /,
    });
  });
});
