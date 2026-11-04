import {deepStrictEqual} from 'node:assert';
import {chatUsages, checkPublicSurface} from './public-surface.ts';
import {REPOSITORY_ROOT} from './repository.ts';
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

  it('R-31: an aka.ms address in a localisation bundle fails, naming the file and the address', () => {
    workspace.write(
      'packages/remote-x/l10n/bundle.l10n.json',
      '{\n  "learn": "See [more](https://aka.ms/x)."\n}\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is an address')),
      ),
      ["packages/remote-x/l10n/bundle.l10n.json:2: 'https://aka.ms/x'"],
    );
  });

  it('R-31: an aka.ms address in package.nls fails too', () => {
    workspace.write(
      'packages/remote-x/package.nls.json',
      '{"learn": "http://aka.ms/devcontainer"}\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is an address')),
      ),
      ["packages/remote-x/package.nls.json:1: 'http://aka.ms/devcontainer'"],
    );
  });

  it('R-31: an address of our own passes', () => {
    workspace.write(
      'packages/remote-x/l10n/bundle.l10n.json',
      '{"learn": "https://github.com/remote-oss/remote/blob/main/README.md"}\n',
    );
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('R-31: the repository’s shipped files hold no aka.ms address', () => {
    deepStrictEqual(
      checkPublicSurface(REPOSITORY_ROOT).filter(problem =>
        problem.includes('aka.ms'),
      ),
      [],
    );
  });

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

  it('lets the plain sense of the word stand in a localisation bundle (ruling-2165-plain-reference)', () => {
    workspace.write(
      'packages/remote-x/l10n/bundle.l10n.json',
      '{\n  "s294": "Replace the reference to the discontinued devcontainers-contrib."\n}\n',
    );
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('lets the plain sense of the word stand in the default nls table too', () => {
    workspace.write(
      'packages/remote-x/package.nls.json',
      '{\n  "s294": "Replace the reference to the discontinued devcontainers-contrib."\n}\n',
    );
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('still flags the word in a localisation bundle when it names the process', () => {
    workspace.write(
      'packages/remote-x/l10n/bundle.l10n.json',
      '{\n  "note": "the reference shows the setup problem."\n}\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      ["packages/remote-x/l10n/bundle.l10n.json:2: 'the reference'"],
    );
  });

  it('still flags the word in a README, followed by " to "', () => {
    workspace.write(
      'packages/remote-x/README.md',
      'Replace the reference to the old host.\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      ["packages/remote-x/README.md:1: 'the reference'"],
    );
  });

  it('lets an address the specification fixes verbatim pass in the manifest (ruling-2165-schema-url)', () => {
    workspace.write(
      'packages/remote-x/package.json',
      '{\n  "url": "https://raw.githubusercontent.com/devcontainers/spec/main/schemas/devContainerFeature.schema.json"\n}\n',
    );
    deepStrictEqual(checkPublicSurface(workspace.root), []);
  });

  it('still flags the bare word in the manifest beside the allowed address', () => {
    workspace.write(
      'packages/remote-x/package.json',
      '{\n  "url": "https://raw.githubusercontent.com/devcontainers/spec/main/schemas/devContainerFeature.schema.json",\n  "note": "an open spec question"\n}\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      ["packages/remote-x/package.json:3: 'spec'"],
    );
  });

  it('still flags the word in another address with a /spec/ segment', () => {
    workspace.write(
      'packages/remote-x/README.md',
      'See https://example.com/spec/main/schema.json.\n',
    );
    deepStrictEqual(
      checkPublicSurface(workspace.root).map(problem =>
        problem.slice(0, problem.indexOf(' is wording')),
      ),
      ["packages/remote-x/README.md:1: 'spec'"],
    );
  });

  it('leaves the licence texts of third parties alone', () => {
    workspace.write(
      'packages/remote-x/ThirdPartyNotices.txt',
      'Microsoft Corporation\n',
    );
    workspace.write('packages/remote-x/NOTICE.md', 'Microsoft Corporation\n');
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

  describe('F-3907: no chat or language-model use in remote-ssh or lib-ssh', () => {
    const SOURCE_FORMS = [
      'vscode.chat',
      'vscode.lm',
      'chat.createChatParticipant',
      'lm.selectChatModels',
    ];

    for (const form of SOURCE_FORMS) {
      it(`F-2606.AC-26: source text of remote-ssh using ${form} fails, naming the file, the line and the form`, () => {
        workspace.write(
          'packages/remote-ssh/src/usage.ts',
          `export const x = 1;\nexport const api = ${form};\n`,
        );
        deepStrictEqual(chatUsages(workspace.root), [
          `packages/remote-ssh/src/usage.ts:2: '${form}' (F-3907: no chat or language-model use)`,
        ]);
      });
    }

    it('F-2606.AC-26: source text of lib-ssh using vscode.lm fails too', () => {
      workspace.write(
        'packages/lib-ssh/src/usage.ts',
        'export const models = vscode.lm;\n',
      );
      deepStrictEqual(chatUsages(workspace.root), [
        "packages/lib-ssh/src/usage.ts:1: 'vscode.lm' (F-3907: no chat or language-model use)",
      ]);
    });

    const DEPENDENCY_FORMS = [
      '@vscode/prompt-tsx',
      '@vscode/chat-extension-utils',
      'openai',
      '@azure/openai',
      '@anthropic-ai/sdk',
      'ai',
      'langchain',
      '@langchain/core',
      '@ai-sdk/openai',
    ];

    for (const name of DEPENDENCY_FORMS) {
      it(`F-2606.AC-26: a dependency named ${name} fails, naming the manifest and the line`, () => {
        workspace.write(
          'packages/remote-ssh/package.json',
          JSON.stringify({dependencies: {[name]: '1.0.0'}}),
        );
        deepStrictEqual(chatUsages(workspace.root), [
          `packages/remote-ssh/package.json:1: '${name}' (F-3907: no chat or language-model use)`,
        ]);
      });
    }

    it('F-2606.AC-26: a dependency of another package is not a finding', () => {
      workspace.write(
        'packages/remote-x/package.json',
        JSON.stringify({dependencies: {openai: '1.0.0'}}),
      );
      deepStrictEqual(chatUsages(workspace.root), []);
    });

    it('F-2606.AC-26: the repository’s remote-ssh and lib-ssh hold no chat or language-model use', () => {
      deepStrictEqual(chatUsages(REPOSITORY_ROOT), []);
    });
  });
});
