import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import path from 'node:path';
import {REPOSITORY_ROOT} from './repository.ts';
import {checkStringTables} from './string-tables.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const LOCALES = [
  'cs',
  'de',
  'es',
  'fr',
  'hu',
  'it',
  'ja',
  'ko',
  'pl',
  'pt-br',
  'ru',
  'tr',
  'zh-cn',
  'zh-tw',
];

describe('string-tables', () => {
  let workspace: TemporaryWorkspace;

  function write(file: string, content: unknown): void {
    workspace.write(`packages/remote-x/${file}`, content);
  }

  function remove(file: string): void {
    rmSync(path.join(workspace.root, 'packages/remote-x', file), {
      recursive: true,
    });
  }

  function problems(): string[] {
    return checkStringTables(workspace.root, 'remote-x');
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('string-tables');
    workspace.writeManifest('remote-x', {
      description: '%description%',
      displayName: 'Name',
    });
    write('package.nls.json', {description: 'Edits files'});
    for (const locale of LOCALES) {
      write(`package.nls.${locale}.json`, {description: 'Bearbeitet Dateien'});
      write(`l10n/bundle.l10n.${locale}.json`, {
        Label: 'Etikett',
        Text: 'Text',
      });
    }
  });

  afterEach(() => {
    workspace.remove();
  });

  it('passes complete tables', () => {
    deepStrictEqual(problems(), []);
  });

  it('passes a package without an l10n folder', () => {
    remove('l10n');
    deepStrictEqual(problems(), []);
  });

  it('passes a package without string tables', () => {
    workspace.writeManifest('remote-y');
    deepStrictEqual(checkStringTables(workspace.root, 'remote-y'), []);
  });

  it('reports a manifest placeholder without a text', () => {
    workspace.writeManifest('remote-x', {
      description: '%description%',
      title: '%title%',
    });
    deepStrictEqual(problems(), [
      "packages/remote-x/package.json: '%title%' is not in package.nls.json",
    ]);
  });

  it('reports placeholders when package.nls.json is missing', () => {
    remove('package.nls.json');
    deepStrictEqual(problems(), [
      "packages/remote-x/package.json: '%description%' has no package.nls.json",
    ]);
  });

  it('reports a missing locale file, a missing key, an extra key and an empty text', () => {
    remove('package.nls.cs.json');
    write('package.nls.de.json', {other: 'x'});
    write('package.nls.fr.json', {description: ' '});
    deepStrictEqual(problems(), [
      'packages/remote-x/package.nls.cs.json: missing',
      "packages/remote-x/package.nls.de.json: missing key 'description'",
      "packages/remote-x/package.nls.de.json: extra key 'other'",
      "packages/remote-x/package.nls.fr.json: key 'description' has no text",
    ]);
  });

  it('reports a missing locale file of the declared locales', () => {
    workspace.write('packages/remote-x/identifiers.json', {
      source: 'x#1',
      standsDownFor: 'ms.x',
      locales: LOCALES,
    });
    remove('package.nls.cs.json');
    deepStrictEqual(problems(), [
      'packages/remote-x/package.nls.cs.json: missing',
    ]);
  });

  it('reports a table of a locale the package does not declare', () => {
    workspace.write('packages/remote-x/identifiers.json', {
      source: 'x#1',
      standsDownFor: 'ms.x',
      locales: LOCALES.filter(locale => locale !== 'hu'),
    });
    deepStrictEqual(problems(), [
      "packages/remote-x/l10n/bundle.l10n.hu.json: not a bundle of the package's locales",
      "packages/remote-x/package.nls.hu.json: not a table of the package's locales",
    ]);
  });

  it('reports bundles that differ, a missing bundle and a stray file', () => {
    workspace.write('packages/remote-x/identifiers.json', {
      source: 'x#1',
      standsDownFor: 'ms.x',
      locales: LOCALES,
    });
    remove('l10n/bundle.l10n.ja.json');
    write('l10n/bundle.l10n.ko.json', {Label: 'x'});
    write('l10n/notes.json', {});
    deepStrictEqual(problems(), [
      'packages/remote-x/l10n/bundle.l10n.ja.json: missing',
      "packages/remote-x/l10n/bundle.l10n.ko.json: missing key 'Text'",
      "packages/remote-x/l10n/notes.json: not a bundle of the package's locales",
    ]);
  });

  it('checks every bundle against the default bundle when the package ships one', () => {
    write('l10n/bundle.l10n.json', {
      Label: 'Label',
      Text: 'Text',
      More: 'More',
    });
    deepStrictEqual(
      problems(),
      LOCALES.map(
        locale =>
          `packages/remote-x/l10n/bundle.l10n.${locale}.json: missing key 'More'`,
      ),
    );
  });

  it('reports an empty text in the default bundle', () => {
    write('l10n/bundle.l10n.json', {Label: '', Text: 'Text'});
    deepStrictEqual(problems(), [
      "packages/remote-x/l10n/bundle.l10n.json: key 'Label' has no text",
    ]);
  });

  it('reports a default bundle that is not JSON and checks no bundle against it', () => {
    write('l10n/bundle.l10n.json', '{');
    deepStrictEqual(unreadableFiles(), [
      'packages/remote-x/l10n/bundle.l10n.json',
    ]);
  });

  it('reports an empty text in the source table', () => {
    write('package.nls.json', {description: ''});
    deepStrictEqual(problems(), [
      "packages/remote-x/package.nls.json: key 'description' has no text",
    ]);
  });

  function unreadableFiles(): string[] {
    return problems().map(problem =>
      problem.replace(/: cannot be read: .*/, ''),
    );
  }

  it('reports a source table that is not JSON', () => {
    write('package.nls.json', '{');
    deepStrictEqual(unreadableFiles(), ['packages/remote-x/package.nls.json']);
  });

  it('reports a translated table and a bundle that are not JSON objects', () => {
    write('package.nls.it.json', '{');
    write('l10n/bundle.l10n.it.json', '[]');
    deepStrictEqual(unreadableFiles(), [
      'packages/remote-x/l10n/bundle.l10n.it.json',
      'packages/remote-x/package.nls.it.json',
    ]);
  });

  describe('the strings the code translates', () => {
    beforeEach(() => {
      write('l10n/bundle.l10n.json', {Label: 'Label', Text: 'Text'});
    });

    function source(file: string, text: string): void {
      write(file, text);
    }

    it('reports a templates value that is not a key of the bundle, with its file and line', () => {
      source(
        'src/texts.ts',
        "export const FOO_TEMPLATES = {\n  label: 'Label',\n  other: 'Missing',\n} as const;\n",
      );
      deepStrictEqual(problems(), [
        'packages/remote-x/src/texts.ts:3: "Missing" is translated but not a key of l10n/bundle.l10n.json',
      ]);
    });

    it('reports a literal given to l10n.t that is not a key', () => {
      source('src/extension.ts', "vscode.l10n.t('Missing');\n");
      deepStrictEqual(problems(), [
        'packages/remote-x/src/extension.ts:1: "Missing" is translated but not a key of l10n/bundle.l10n.json',
      ]);
    });

    it('reports a same-file constant given to a same-file translate that is not a key', () => {
      source(
        'src/extension.ts',
        "const WARNING = 'w';\nfunction translate(text: string): string {\n  return text;\n}\ntranslate(WARNING);\n",
      );
      deepStrictEqual(problems(), [
        'packages/remote-x/src/extension.ts:5: "w" is translated but not a key of l10n/bundle.l10n.json',
      ]);
    });

    it('reports a same-file constant given to l10n.t that is not a key', () => {
      source('src/extension.ts', "const WARNING = 'w';\nl10n.t(WARNING);\n");
      deepStrictEqual(problems(), [
        'packages/remote-x/src/extension.ts:2: "w" is translated but not a key of l10n/bundle.l10n.json',
      ]);
    });

    it('reports the template given to filled that is not a key', () => {
      source('src/texts.ts', "filled(translate, 'y {0}', []);\n");
      deepStrictEqual(problems(), [
        'packages/remote-x/src/texts.ts:1: "y {0}" is translated but not a key of l10n/bundle.l10n.json',
      ]);
    });

    it('passes when every translated string is a key', () => {
      source(
        'src/texts.ts',
        "export const FOO_TEMPLATES = {label: 'Label'} as const;\nl10n.t('Text');\n",
      );
      deepStrictEqual(problems(), []);
    });

    it('ignores the strings of a test file, a fixture and a test double', () => {
      source('src/texts.test.ts', "l10n.t('Missing');\n");
      source('src/texts.fixture.ts', "l10n.t('Missing');\n");
      source('src/testing/fake.ts', "l10n.t('Missing');\n");
      deepStrictEqual(problems(), []);
    });

    it('ignores a call of translate when the file declares no such function, and a call of another name', () => {
      source(
        'src/texts.ts',
        "translate('Missing');\nother.t('Missing');\nl10n.u('Missing');\n",
      );
      deepStrictEqual(problems(), []);
    });

    it('ignores a constant that is not a string and an argument that is neither a literal nor a constant', () => {
      source(
        'src/texts.ts',
        "const COUNT = 3;\nconst name = 'x';\nl10n.t(COUNT);\nl10n.t(name + 'y');\nl10n.t(name);\n",
      );
      deepStrictEqual(problems().length, 1);
    });

    it('reads the templates of a table wrapped in satisfies, parentheses and a template literal', () => {
      source(
        'src/texts.ts',
        'export const A_TEMPLATES = ({one: `Missing one`, two: 3, ...rest} satisfies object);\n',
      );
      deepStrictEqual(problems(), [
        'packages/remote-x/src/texts.ts:1: "Missing one" is translated but not a key of l10n/bundle.l10n.json',
      ]);
    });

    it('ignores the source of a package without a default bundle', () => {
      remove('l10n/bundle.l10n.json');
      source('src/extension.ts', "l10n.t('Missing');\n");
      deepStrictEqual(problems(), []);
    });

    it('passes a package with a default bundle and no src folder', () => {
      deepStrictEqual(problems(), []);
    });
  });

  it('#680: the packages of the repository translate nothing their bundle lacks', () => {
    deepStrictEqual(
      ['remote-ssh', 'remote-explorer', 'remote-ssh-edit'].flatMap(folder =>
        checkStringTables(REPOSITORY_ROOT, folder),
      ),
      [],
    );
  });
});
