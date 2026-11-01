import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  generatedTables,
  localeTableProblems,
  writeLocaleTables,
} from './locale-tables.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('locale-tables', () => {
  let workspace: TemporaryWorkspace;

  function write(file: string, content: unknown): void {
    workspace.write(`packages/remote-x/${file}`, content);
  }

  function generatedText(file: string): string {
    return generatedTables(workspace.root, 'remote-x').files.get(file) ?? '';
  }

  function generatedTable(file: string): unknown {
    return JSON.parse(generatedText(file));
  }

  function problems(): string[] {
    return generatedTables(workspace.root, 'remote-x').problems;
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('locale-tables');
    workspace.writeManifest('remote-x');
    write('identifiers.json', {
      source: 'remote-oss/remote-x#1 (F-0001)',
      standsDownFor: 'example.remote-x',
      locales: ['de', 'fr'],
    });
    write('package.nls.json', {title: 'Title', body: 'Body'});
    write('l10n/bundle.l10n.json', {Open: 'Open', Close: 'Close'});
  });

  afterEach(() => {
    workspace.remove();
  });

  it('tooling-41: a translated runtime key lands in that locale’s bundle and every other text stays English', () => {
    write('translations/de.json', {runtime: {Open: 'Öffnen'}});
    deepStrictEqual(
      [
        generatedTable('l10n/bundle.l10n.de.json'),
        generatedTable('l10n/bundle.l10n.fr.json'),
      ],
      [
        {Open: 'Öffnen', Close: 'Close'},
        {Open: 'Open', Close: 'Close'},
      ],
    );
  });

  it('tooling-41: a manifest translation lands in that locale’s nls table only', () => {
    write('translations/de.json', {manifest: {title: 'Titel'}});
    deepStrictEqual(
      [
        generatedTable('package.nls.de.json'),
        generatedTable('package.nls.fr.json'),
        generatedTable('l10n/bundle.l10n.de.json'),
      ],
      [
        {title: 'Titel', body: 'Body'},
        {title: 'Title', body: 'Body'},
        {Open: 'Open', Close: 'Close'},
      ],
    );
  });

  it('tooling-41: the keys keep the default table’s order, and the file is written as Prettier writes JSON', () => {
    write('package.nls.json', '{"zebra": "Z", "apple": "A"}');
    deepStrictEqual(
      generatedText('package.nls.de.json'),
      '{\n  "zebra": "Z",\n  "apple": "A"\n}\n',
    );
  });

  it('tooling-41: a package without a l10n folder gets no bundles', () => {
    workspace.remove();
    workspace = new TemporaryWorkspace('locale-tables');
    workspace.writeManifest('remote-x');
    write('identifiers.json', {
      source: 'remote-oss/remote-x#1 (F-0001)',
      standsDownFor: 'example.remote-x',
      locales: ['de'],
    });
    write('package.nls.json', {title: 'Title'});
    deepStrictEqual(
      [...generatedTables(workspace.root, 'remote-x').files.keys()],
      ['package.nls.de.json'],
    );
  });

  it('tooling-41: a package whose identifiers.json states no locales gets nothing', () => {
    write('identifiers.json', {
      source: 'remote-oss/remote-x#1 (F-0001)',
      standsDownFor: 'example.remote-x',
    });
    deepStrictEqual(generatedTables(workspace.root, 'remote-x'), {
      files: new Map(),
      problems: [],
    });
  });

  it('tooling-41: a package with no identifiers.json gets nothing', () => {
    workspace.remove();
    workspace = new TemporaryWorkspace('locale-tables');
    workspace.writeManifest('remote-x');
    write('package.nls.json', {title: 'Title'});
    deepStrictEqual(generatedTables(workspace.root, 'remote-x').files.size, 0);
  });

  it('tooling-41: a translation of a key the default table lacks is a problem', () => {
    write('translations/de.json', {
      manifest: {unknown: 'Text'},
      runtime: {Missing: 'Text'},
    });
    deepStrictEqual(problems(), [
      "translations/de.json: 'unknown' is not a key of the default manifest table",
      "translations/de.json: 'Missing' is not a key of the default runtime table",
    ]);
  });

  it('tooling-41: an empty translated text is a problem', () => {
    write('translations/fr.json', {runtime: {Open: ' '}});
    deepStrictEqual(problems(), ["translations/fr.json: 'Open' has no text"]);
  });

  it('tooling-41: a translations file of a locale the package does not ship is a problem, and so is a file that is no locale’s', () => {
    write('translations/hu.json', {runtime: {Open: 'Megnyitás'}});
    write('translations/notes.txt', 'x');
    deepStrictEqual(problems(), [
      "translations/hu.json: not a translations file of the package's locales",
      "translations/notes.txt: not a translations file of the package's locales",
    ]);
  });

  it('tooling-41: a translations file that is not a table, with a part that is not one or is no part, is a problem', () => {
    write('translations/de.json', {manifest: ['x'], other: {}});
    write('translations/fr.json', '[]');
    deepStrictEqual(problems(), [
      "translations/de.json: 'manifest' is not a table",
      "translations/de.json: 'other' is neither 'manifest' nor 'runtime'",
      'translations/fr.json: cannot be read: not a JSON object',
    ]);
  });

  it('tooling-41: a default table that cannot be read is a problem and generates nothing for it', () => {
    write('package.nls.json', '{');
    deepStrictEqual(
      [
        problems().map(text =>
          text.startsWith('package.nls.json: cannot be read'),
        ),
        [...generatedTables(workspace.root, 'remote-x').files.keys()],
      ],
      [[true], ['l10n/bundle.l10n.de.json', 'l10n/bundle.l10n.fr.json']],
    );
  });

  describe('--check', () => {
    function check(): string[] {
      return localeTableProblems(workspace.root);
    }

    it('tooling-41: every generated table missing is one problem each', () => {
      deepStrictEqual(check(), [
        'packages/remote-x/package.nls.de.json: missing',
        'packages/remote-x/l10n/bundle.l10n.de.json: missing',
        'packages/remote-x/package.nls.fr.json: missing',
        'packages/remote-x/l10n/bundle.l10n.fr.json: missing',
      ]);
    });

    it('tooling-41: the written tables pass, and a changed one is stale', () => {
      writeLocaleTables(workspace.root);
      const clean = check();
      write('package.nls.de.json', {title: 'Titel', body: 'Body'});
      deepStrictEqual(
        [clean, check()],
        [[], ['packages/remote-x/package.nls.de.json: stale']],
      );
    });

    it('tooling-41: a bad translation, an unknown locale and an empty text are reported once each, beside the stale ones', () => {
      writeLocaleTables(workspace.root);
      write('translations/de.json', {manifest: {unknown: 'Text'}});
      write('translations/fr.json', {runtime: {Open: ''}});
      write('translations/hu.json', {});
      deepStrictEqual(check(), [
        "packages/remote-x/translations/hu.json: not a translations file of the package's locales",
        "packages/remote-x/translations/de.json: 'unknown' is not a key of the default manifest table",
        "packages/remote-x/translations/fr.json: 'Open' has no text",
        'packages/remote-x/l10n/bundle.l10n.fr.json: stale',
      ]);
    });
  });

  describe('writing', () => {
    it('tooling-41: writes the tables of every locale, the translated text included', () => {
      write('translations/de.json', {runtime: {Close: 'Schließen'}});
      writeLocaleTables(workspace.root);
      deepStrictEqual(
        JSON.parse(
          readFileSync(
            path.join(
              workspace.root,
              'packages/remote-x/l10n/bundle.l10n.de.json',
            ),
            'utf8',
          ),
        ),
        {Open: 'Open', Close: 'Schließen'},
      );
    });

    it('tooling-41: writes nothing and names the sources when one is wrong', () => {
      write('translations/de.json', {runtime: {Close: ''}});
      let message = '';
      try {
        writeLocaleTables(workspace.root);
      } catch (caught) {
        message = (caught as Error).message;
      }
      deepStrictEqual(
        [
          message,
          existsSync(
            path.join(workspace.root, 'packages/remote-x/package.nls.de.json'),
          ),
        ],
        ["packages/remote-x/translations/de.json: 'Close' has no text", false],
      );
    });
  });
});
