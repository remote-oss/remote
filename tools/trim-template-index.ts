/**
 * @fileoverview trim-template-index: the acceptance run's pinned template index, cut from the public one.
 *
 *     node tools/trim-template-index.ts <full index file> <date>
 *
 * The full file is the dev container specification's published index
 * (https://containers.dev/static/devcontainer-index.json), downloaded on `<date>`. The cut keeps the one collection
 * of the specification's own templates, its source information and its templates' metadata, and no Features; it is
 * written to tests/acceptance/fixtures/templates/devcontainer-index.json, and SOURCE.md beside it records where it came
 * from.
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

/** Where the snapshot and its source note are kept. */
export const SNAPSHOT_FOLDER = path.join(
  'tests',
  'acceptance',
  'fixtures',
  'templates',
);

/** One collection of the index, as far as the cut reads it. */
interface IndexCollection {
  sourceInformation?: {ociReference?: unknown};
  templates?: unknown;
}

/**
 * The index text holding only the collection whose source is `TEMPLATES_REFERENCE`, without its Features. Throws when
 * the text is not an index or holds no such collection.
 */
export function trimmedIndex(fullText: string): string {
  const parsed = JSON.parse(fullText) as {collections?: unknown};
  if (!Array.isArray(parsed.collections)) {
    throw new Error('the index has no collections');
  }
  const kept = (parsed.collections as IndexCollection[]).find(
    collection =>
      collection.sourceInformation?.ociReference === TEMPLATES_REFERENCE,
  );
  if (kept === undefined || !Array.isArray(kept.templates)) {
    throw new Error(`the index has no ${TEMPLATES_REFERENCE} collection`);
  }
  const collection = {
    sourceInformation: kept.sourceInformation,
    templates: kept.templates,
  };
  return `${JSON.stringify({collections: [collection]}, undefined, 2)}\n`;
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
    'templates, published under the MIT licence in `LICENSE` beside this file. It is test data of the acceptance run',
    'only and reaches no package.',
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
