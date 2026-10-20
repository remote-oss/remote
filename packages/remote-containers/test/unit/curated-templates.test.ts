import {deepStrictEqual} from 'node:assert';
import type {CatalogueTemplate} from '../../src/authoring/catalogue.ts';
import {
  curatedTemplates,
  type FolderFacts,
  isCurated,
} from '../../src/authoring/curated-templates.ts';

const PREFIX = 'ghcr.io/devcontainers/templates/';

/** A template of the catalogue named `part`, under `prefix`. */
function templateOf(part: string, prefix = PREFIX): CatalogueTemplate {
  return {
    id: `${prefix}${part}`,
    version: '1.0.0',
    name: part,
    owner: 'devcontainers',
    options: {},
    optionalPaths: [],
  };
}

/** The facts of a folder holding the files at `paths`. */
function factsOf(paths: string[], truncated = false): FolderFacts {
  return {rootEntries: [], files: paths, truncated};
}

const CORE = [
  'alpine',
  'debian',
  'docker-in-docker',
  'docker-outside-of-docker',
  'docker-outside-of-docker-compose',
  'kubernetes-helm',
  'kubernetes-helm-minikube',
  'ubuntu',
];

/** The last parts of the ids of `templates`. */
function partsOf(templates: readonly CatalogueTemplate[]): string[] {
  return templates.map(each => each.id.slice(each.id.lastIndexOf('/') + 1));
}

describe('the rule of the curated list (card containers-79)', () => {
  it('F-0802 AC-26, AC-34: a folder with no file, or only neutral files, is not curated', () => {
    deepStrictEqual(
      [
        isCurated(factsOf([])),
        isCurated(
          factsOf([
            'readme.txt',
            'foo.txt',
            'requirements.txt',
            'README.md',
            'data.json',
            'package.json',
            'Makefile',
            'Gemfile',
          ]),
        ),
      ],
      [false, false],
    );
  });

  it('F-0802 AC-26: a file that is not neutral makes the folder curated, at any depth', () => {
    deepStrictEqual(
      [
        isCurated(factsOf(['main.go'])),
        isCurated(factsOf(['a/b/c/d/e/f/g/tool.py'])),
        isCurated(factsOf(['notes.TXT', 'Dockerfile'])),
      ],
      [true, true, true],
    );
  });

  it('F-0802 AC-35: a file inside .git never counts, and a folder never does', () => {
    deepStrictEqual(
      [
        isCurated(factsOf(['.git/hooks/pre-commit', 'a/.git/config'])),
        isCurated(factsOf(['.gitignore'])),
      ],
      [false, true],
    );
  });

  it('F-0802 AC-26: a walk that had no end makes the folder curated', () => {
    deepStrictEqual(isCurated(factsOf([], true)), true);
  });
});

describe('our curated table (card containers-79)', () => {
  it('F-0802 AC-24: the core templates are always in it, in the catalogue’s order, and nothing else with no match', () => {
    const catalogue = [
      ...CORE.map(part => templateOf(part)),
      templateOf('go'),
      templateOf('python'),
    ];
    deepStrictEqual(
      partsOf(curatedTemplates(catalogue, factsOf(['x.unknown']), PREFIX)),
      CORE,
    );
  });

  it('F-0802 AC-25: every file present adds its matches, neutral ones included, once', () => {
    const catalogue = [
      'go',
      'go-postgres',
      'universal',
      'python',
      'javascript-node',
      'javascript-node-mongo',
      'typescript-node',
      'dotnet',
      'rust',
      'java',
    ].map(part => templateOf(part));
    deepStrictEqual(
      partsOf(
        curatedTemplates(
          catalogue,
          factsOf(['a.go', 'b.go', 'src/package.json', 'x.ts']),
          PREFIX,
        ),
      ),
      [
        'go',
        'go-postgres',
        'universal',
        'javascript-node',
        'javascript-node-mongo',
        'typescript-node',
      ],
    );
  });

  it('F-0802 AC-28: the other languages match their templates', () => {
    const catalogue = [
      'python',
      'anaconda',
      'miniconda-postgres',
      'dotnet',
      'dotnet-fsharp',
      'rust',
      'java',
      'universal',
    ].map(part => templateOf(part));
    deepStrictEqual(
      partsOf(
        curatedTemplates(
          catalogue,
          factsOf(['a.PY', 'b.csproj', 'c.rs', 'd.java']),
          PREFIX,
        ),
      ),
      [
        'python',
        'anaconda',
        'miniconda-postgres',
        'dotnet',
        'dotnet-fsharp',
        'rust',
        'java',
        'universal',
      ],
    );
  });

  it('F-0802 AC-30: a match whose id is not in the catalogue is left out, and so is a file inside .git', () => {
    deepStrictEqual(
      partsOf(
        curatedTemplates(
          [templateOf('go'), templateOf('alpine')],
          factsOf(['a.go', '.git/x.rs']),
          PREFIX,
        ),
      ),
      ['go', 'alpine'],
    );
  });

  it('F-0802 AC-25: only templates under the prefix given count', () => {
    deepStrictEqual(
      partsOf(
        curatedTemplates(
          [
            templateOf('alpine'),
            templateOf('debian', '127.0.0.1:5000/templates/'),
            templateOf('ubuntu', 'ghcr.io/someone/templates/'),
          ],
          factsOf(['x.go']),
          '127.0.0.1:5000/templates/',
        ),
      ),
      ['debian'],
    );
  });
});
