/**
 * @fileoverview Our own table of the templates the curated list shows, and the rule that decides when it shows. The
 * curated list shows when any significant file exists below the folder: a file that is not neutral, `.git` excluded
 * and folders never counting. The neutral files are `*.txt`, `*.md`, `*.json`, `Makefile` and `Gemfile`, the names
 * and patterns observed to leave the full list on (`readme.txt`, `foo.txt`, `requirements.txt`, `README.md`,
 * `data.json`, `package.json`, `Makefile`, `Gemfile`), generalised. Once the curated list shows, every file present
 * adds its language matches, neutral ones included, once: the eight core templates are always in it. A match whose
 * id is not in the catalogue is left out. The specification's own collection is the one whose repository is
 * `SPECIFICATION_TEMPLATES_REPOSITORY`, as the index publishes it: its templates carry the verified mark, and the
 * folder their ids share is the prefix the curated table matches under.
 */

import type {CatalogueTemplate} from './catalogue.ts';

/** The repository of the specification's own collection of templates, matched exactly. */
const SPECIFICATION_TEMPLATES_REPOSITORY =
  'https://github.com/devcontainers/templates';

/** One entry of the folder's root. */
export interface RootEntry {
  name: string;
  kind: 'file' | 'folder' | 'other';
}

/** What the caller read of the folder before the pick, so that the pick touches no file. */
export interface FolderFacts {
  rootEntries: readonly RootEntry[];
  /** The files below the folder, as paths relative to it with `/`; folders are not listed. */
  files: readonly string[];
  /** Whether the walk stopped at its bound: the folder then counts as holding a significant file. */
  truncated: boolean;
}

/** The templates of the core set, by the last part of their ids. */
const CORE_TEMPLATES: readonly string[] = [
  'alpine',
  'debian',
  'docker-in-docker',
  'docker-outside-of-docker',
  'docker-outside-of-docker-compose',
  'kubernetes-helm',
  'kubernetes-helm-minikube',
  'ubuntu',
];

/** The extensions of the neutral files. */
const NEUTRAL_EXTENSIONS: readonly string[] = ['.txt', '.md', '.json'];

/** The names of the neutral files without an extension. */
const NEUTRAL_NAMES: readonly string[] = ['Makefile', 'Gemfile'];

/** A file name or pattern, and the templates it matches. */
interface LanguageMatch {
  matches(name: string): boolean;
  templates: readonly string[];
}

function withExtension(extension: string): (name: string) => boolean {
  return name => name.toLowerCase().endsWith(extension);
}

const LANGUAGE_MATCHES: readonly LanguageMatch[] = [
  {
    matches: withExtension('.go'),
    templates: ['go', 'go-postgres', 'universal'],
  },
  {
    matches: withExtension('.py'),
    templates: [
      'python',
      'anaconda',
      'anaconda-postgres',
      'miniconda',
      'miniconda-postgres',
      'universal',
    ],
  },
  {
    matches: withExtension('.js'),
    templates: [
      'javascript-node',
      'javascript-node-mongo',
      'javascript-node-postgres',
      'universal',
    ],
  },
  {
    matches: name => name === 'package.json',
    templates: [
      'javascript-node',
      'javascript-node-mongo',
      'javascript-node-postgres',
    ],
  },
  {
    matches: withExtension('.ts'),
    templates: ['typescript-node', 'universal'],
  },
  {
    matches: withExtension('.csproj'),
    templates: ['dotnet', 'dotnet-mssql', 'dotnet-postgres', 'dotnet-fsharp'],
  },
  {matches: withExtension('.rs'), templates: ['rust', 'universal']},
  {matches: withExtension('.java'), templates: ['java', 'universal']},
];

/** The name of the file a path ends in. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Whether a path is inside a `.git` folder, whose files never count. */
function insideGit(path: string): boolean {
  return path.split('/').slice(0, -1).includes('.git');
}

function isNeutral(name: string): boolean {
  return (
    NEUTRAL_NAMES.includes(name) ||
    NEUTRAL_EXTENSIONS.some(extension => name.toLowerCase().endsWith(extension))
  );
}

/** The files that count: those outside `.git`. */
function countedFiles(facts: FolderFacts): string[] {
  return facts.files.filter(path => !insideGit(path)).map(baseName);
}

/** Whether the curated list shows for the folder: a file that is not neutral exists below it, or the walk had no end. */
export function isCurated(facts: FolderFacts): boolean {
  return facts.truncated || countedFiles(facts).some(name => !isNeutral(name));
}

/** The last part of a template's id. */
function lastPartOf(template: CatalogueTemplate): string {
  return template.id.slice(template.id.lastIndexOf('/') + 1);
}

/**
 * The templates of the curated list, in the catalogue's order: the core set and the matches of every file present,
 * among the templates of the catalogue whose ids start with `prefix`, the one of the catalogue's own collection.
 */
export function curatedTemplates(
  catalogue: readonly CatalogueTemplate[],
  facts: FolderFacts,
  prefix: string,
): CatalogueTemplate[] {
  const wanted = new Set<string>(CORE_TEMPLATES);
  for (const name of countedFiles(facts)) {
    for (const language of LANGUAGE_MATCHES) {
      if (language.matches(name)) {
        language.templates.forEach(each => wanted.add(each));
      }
    }
  }
  return catalogue.filter(
    template =>
      template.id.startsWith(prefix) && wanted.has(lastPartOf(template)),
  );
}

/** Whether the template belongs to the specification's own collection, which is what the verified mark means. */
export function isSpecificationTemplate(template: CatalogueTemplate): boolean {
  return template.collectionRepository === SPECIFICATION_TEMPLATES_REPOSITORY;
}

/** The folder of an id, with its last `/`. */
function folderOf(template: CatalogueTemplate): string {
  return template.id.slice(0, template.id.lastIndexOf('/') + 1);
}

/**
 * The prefix of the specification's collection: the folder its templates' ids share. Nothing when the catalogue has no
 * such template or their folders differ, which leaves the flat list; `report` is told why, once.
 */
export function curatedPrefixOf(
  templates: readonly CatalogueTemplate[],
  report: (line: string) => void,
): string | undefined {
  const folders = new Set(
    templates.filter(isSpecificationTemplate).map(folderOf),
  );
  if (folders.size === 1) {
    return [...folders][0];
  }
  report(
    folders.size === 0
      ? 'the catalogue has no specification template collection; the flat list is shown'
      : 'the specification template collection has no common folder; the flat list is shown',
  );
  return undefined;
}
