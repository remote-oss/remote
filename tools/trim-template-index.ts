/**
 * @fileoverview trim-template-index: the acceptance run's pinned template index, cut from the public one.
 *
 *     node tools/trim-template-index.ts <full index file> <date>
 *
 * The full file is the dev container specification's published index
 * (https://containers.dev/static/devcontainer-index.json), downloaded on `<date>`. The cut keeps the one collection
 * of the specification's own templates, its source information and its templates' metadata, and the few Features the
 * rows list: some of the specification's own and three of the community's. It is written to
 * tests/acceptance/fixtures/templates/devcontainer-index.json, and SOURCE.md beside it records where it came from.
 */

import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** The published index the snapshot is cut from. */
export const PUBLIC_INDEX_URL =
  'https://containers.dev/static/devcontainer-index.json';

/** The registry path of the specification's own template collection. */
export const TEMPLATES_REFERENCE = 'ghcr.io/devcontainers/templates';

/** The registry path of the specification's own Feature collection. */
export const FEATURES_REFERENCE = 'ghcr.io/devcontainers/features';

/** The specification's own Features the cut keeps, by the last segment of their ids. */
export const KEPT_FEATURES: readonly string[] = [
  'common-utils',
  'docker-in-docker',
  'git',
  'node',
  'python',
];

/**
 * The community Features the cut keeps, by name: three whose labels sort differently without regard to case than by
 * code unit.
 */
export const KEPT_COMMUNITY_FEATURES: readonly string[] = [
  'Add Host',
  'add-script',
  'Adobe Experience Manager LTS',
];

/** Where the snapshot and its source note are kept. */
export const SNAPSHOT_FOLDER = path.join(
  'tests',
  'acceptance',
  'fixtures',
  'templates',
);

/** One Feature of the index, as far as the cut reads it. */
interface IndexFeature {
  id?: unknown;
  name?: unknown;
}

/** One collection of the index, as far as the cut reads it. */
interface IndexCollection {
  sourceInformation?: {ociReference?: unknown};
  features?: IndexFeature[];
  templates?: unknown;
}

/** A collection as the cut writes it: its source information and its templates or its kept Features. */
interface KeptCollection {
  sourceInformation: IndexCollection['sourceInformation'];
  features?: IndexFeature[];
  templates?: unknown;
}

/** The Features of `collection` that `wanted` accepts, in the collection's order. */
function keptFeatures(
  collection: IndexCollection,
  wanted: (feature: IndexFeature) => boolean,
): IndexFeature[] {
  return (collection.features ?? []).filter(wanted);
}

/**
 * The index text holding the collection whose source is `TEMPLATES_REFERENCE`, the specification's Features of
 * `KEPT_FEATURES` and the community Features of `KEPT_COMMUNITY_FEATURES`, each with its collection's source information
 * and nothing else of the collection, in the order of the full index. Throws when the text is not an index, holds no
 * templates collection, or lacks a Feature to keep, naming it.
 */
export function trimmedIndex(fullText: string): string {
  const parsed = JSON.parse(fullText) as {collections?: unknown};
  if (!Array.isArray(parsed.collections)) {
    throw new Error('the index has no collections');
  }
  const collections = parsed.collections as IndexCollection[];
  const templates = collections.find(
    collection =>
      collection.sourceInformation?.ociReference === TEMPLATES_REFERENCE,
  );
  if (templates === undefined || !Array.isArray(templates.templates)) {
    throw new Error(`the index has no ${TEMPLATES_REFERENCE} collection`);
  }
  const keptIds = KEPT_FEATURES.map(name => `${FEATURES_REFERENCE}/${name}`);
  const kept = collections.flatMap((collection): KeptCollection[] => {
    if (collection === templates) {
      return [
        {
          sourceInformation: collection.sourceInformation,
          templates: collection.templates,
        },
      ];
    }
    const features = keptFeatures(collection, feature =>
      collection.sourceInformation?.ociReference === FEATURES_REFERENCE
        ? keptIds.includes(String(feature.id))
        : KEPT_COMMUNITY_FEATURES.includes(String(feature.name)),
    );
    return features.length === 0
      ? []
      : [{sourceInformation: collection.sourceInformation, features}];
  });
  const keptFeatureList = kept.flatMap(collection => collection.features ?? []);
  for (const keptId of keptIds) {
    if (!keptFeatureList.some(feature => feature.id === keptId)) {
      throw new Error(`the index has no Feature ${keptId}`);
    }
  }
  for (const name of KEPT_COMMUNITY_FEATURES) {
    if (!keptFeatureList.some(feature => feature.name === name)) {
      throw new Error(`the index has no Feature named "${name}"`);
    }
  }
  return `${JSON.stringify({collections: kept}, undefined, 2)}\n`;
}

/** Where the snapshot came from: the URL, the download's date and the full file's digest, as SOURCE.md says it. */
export function sourceNote(fullText: string, date: string): string {
  const digest = createHash('sha256').update(fullText).digest('hex');
  return [
    '# Source of devcontainer-index.json',
    '',
    `Cut by \`tools/trim-template-index.ts\` from ${PUBLIC_INDEX_URL},`,
    `downloaded on ${date}. The full file's sha256 was \`${digest}\`.`,
    '',
    `It keeps only the metadata of the \`${TEMPLATES_REFERENCE}\` collection, the specification's own`,
    `templates, of the Features ${KEPT_FEATURES.map(name => `\`${name}\``).join(', ')} of \`${FEATURES_REFERENCE}\`,`,
    `and of the community Features ${KEPT_COMMUNITY_FEATURES.map(name => `\`${name}\``).join(', ')}, each with its`,
    "collection's source information. The collections hold nothing else. The metadata is published under the MIT licence",
    'in `LICENSE` beside this file. It is test data of the acceptance run only and reaches no package.',
    '',
  ].join('\n');
}

if (isMainModule(import.meta.url)) {
  const [fullFile, date] = process.argv.slice(2);
  if (fullFile === undefined || date === undefined) {
    console.error(
      'usage: node tools/trim-template-index.ts <full index file> <date>',
    );
    process.exitCode = 2;
  } else {
    const fullText = readFileSync(fullFile, 'utf8');
    const folder = path.join(REPOSITORY_ROOT, SNAPSHOT_FOLDER);
    writeFileSync(
      path.join(folder, 'devcontainer-index.json'),
      trimmedIndex(fullText),
    );
    writeFileSync(path.join(folder, 'SOURCE.md'), sourceNote(fullText, date));
    console.log(`trim-template-index: ${SNAPSHOT_FOLDER}`);
  }
}
