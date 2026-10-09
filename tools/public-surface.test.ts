import {deepStrictEqual} from 'node:assert';
import {checkPublicSurface} from './public-surface.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('public-surface', () => {
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('public-surface');
    workspace.writeManifest('remote-x');
  });

  afterEach(() => {
    workspace.remove();
  });

  it('passes a tree whose shipped files speak as a product', () => {
    workspace.write(
      'packages/remote-x/README.md',
      '# remote-x\n\nWork anywhere.\n',
    );
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  const FILES = [
    'README.md',
    'CHANGELOG.md',
    'package.nls.json',
    'package.nls.de.json',
    'l10n/bundle.l10n.json',
    'syntaxes/grammar.json',
    'language-configuration.json',
    'package.json',
  ];
  for (const file of FILES) {
    it(`reports process wording in packages/remote-x/${file}`, () => {
      workspace.write(
        `packages/remote-x/${file}`,
        'Line one.\nSee the card.\n',
      );
      deepStrictEqual(
        checkPublicSurface(workspace.root).map(problem =>
          problem.slice(0, problem.indexOf(' is wording')),
        ),
        [`packages/remote-x/${file}:2: 'card'`],
      );
    });
  }

  it('reports the line of each match', () => {
    workspace.write(
      'packages/remote-x/README.md',
      'Ok.\n\nThe worker.\nThe lab.\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      [
        "packages/remote-x/README.md:3: 'worker'",
        "packages/remote-x/README.md:4: 'lab'",
      ],
    );
  });

  it('reports a phrase that wraps over a line end at the line where it starts', () => {
    workspace.write('packages/remote-x/README.md', 'as the\nreference does\n');
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      ["packages/remote-x/README.md:1: 'the reference'"],
    );
  });

  it('leaves the licence texts of third parties alone', () => {
    workspace.write(
      'packages/remote-x/ThirdPartyNotices.txt',
      'Microsoft Corporation\n',
    );
    workspace.write('packages/remote-x/LICENSE', 'Microsoft Corporation\n');
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('leaves files that do not ship alone', () => {
    workspace.write('packages/remote-x/identifiers.json', {source: 'the card'});
    workspace.write('packages/remote-x/coverage.json', {note: 'the card'});
    workspace.write(
      'packages/remote-x/test/fixtures/other.json',
      '{"note": "the card"}',
    );
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('reports process wording in the shipped identifier inventory of a fidelity test', () => {
    workspace.write(
      'packages/remote-x/test/fixtures/identity-inventory.json',
      '{"commands": [{"id": "acme.open", "title": "the card of the worker"}]}',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      [
        "packages/remote-x/test/fixtures/identity-inventory.json:1: 'card'",
        "packages/remote-x/test/fixtures/identity-inventory.json:1: 'worker'",
      ],
    );
  });

  it('checks the user documentation of an extension', () => {
    workspace.write('docs/remote-ssh/connect.md', 'Ask the worker.\n');
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      ["docs/remote-ssh/connect.md:1: 'worker'"],
    );
  });

  it('leaves the working documents alone', () => {
    workspace.write(
      'docs/architecture/design.md',
      'The worker and the card.\n',
    );
    workspace.write('docs/adr/0001-x.md', 'The worker and the card.\n');
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('reports process wording in the pull request template', () => {
    workspace.write(
      '.github/pull_request_template.md',
      'Line one.\nSee the card.\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      [".github/pull_request_template.md:2: 'card'"],
    );
  });

  it('reports process wording in the root contributing guide', () => {
    workspace.write('CONTRIBUTING.md', 'Line one.\nAsk the worker.\n');
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      ["CONTRIBUTING.md:2: 'worker'"],
    );
  });

  it('passes a contributing guide and template that speak as a product', () => {
    workspace.write('.github/pull_request_template.md', 'What changes.\n');
    workspace.write('CONTRIBUTING.md', 'Answer the six questions.\n');
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('passes a tree without a docs folder', () => {
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });
});
