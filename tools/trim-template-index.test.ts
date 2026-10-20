/**
 * @fileoverview The cut of the public template index into the run's pinned snapshot.
 */

import {deepStrictEqual, throws} from 'node:assert';
import {
  FEATURES_REFERENCE,
  KEPT_COMMUNITY_FEATURES,
  KEPT_FEATURES,
  PUBLIC_INDEX_URL,
  sourceNote,
  TEMPLATES_REFERENCE,
  trimmedIndex,
} from './trim-template-index.ts';

/** A Feature of the specification's collection, by the last segment of its id. */
function coreFeature(name: string): {id: string; name: string} {
  return {id: `${FEATURES_REFERENCE}/${name}`, name};
}

/** A small index in the public one's shape: the specification's Features and templates, and the community's. */
function fullIndex(options: {without?: string} = {}): string {
  return JSON.stringify({
    collections: [
      {
        sourceInformation: {ociReference: FEATURES_REFERENCE},
        features: [...KEPT_FEATURES, 'ruby']
          .filter(name => name !== options.without)
          .map(coreFeature),
        templates: [],
      },
      {
        sourceInformation: {
          name: 'Templates',
          ociReference: TEMPLATES_REFERENCE,
        },
        features: [{id: 'a feature of the templates collection'}],
        templates: [{id: `${TEMPLATES_REFERENCE}/alpine`, name: 'Alpine'}],
      },
      {
        sourceInformation: {ociReference: 'ghcr.io/someone/templates'},
        templates: [{id: 'ghcr.io/someone/templates/thing'}],
      },
      {
        sourceInformation: {ociReference: 'ghcr.io/someone/features'},
        features: [...KEPT_COMMUNITY_FEATURES.slice(0, 2), 'Another Feature']
          .filter(name => name !== options.without)
          .map(name => ({id: `ghcr.io/someone/features/${name}`, name})),
      },
      {
        sourceInformation: {ociReference: 'ghcr.io/someone-else/features'},
        features: [
          {
            id: 'ghcr.io/someone-else/features/third',
            name: KEPT_COMMUNITY_FEATURES[2],
          },
        ],
      },
    ],
  });
}

describe('trimmedIndex', () => {
  it("tooling-61: the specification's template collection, its Features of the list and the community's of the list are kept, each with its source and nothing else of its collection", () => {
    deepStrictEqual(JSON.parse(trimmedIndex(fullIndex())), {
      collections: [
        {
          sourceInformation: {ociReference: FEATURES_REFERENCE},
          features: KEPT_FEATURES.map(coreFeature),
        },
        {
          sourceInformation: {
            name: 'Templates',
            ociReference: TEMPLATES_REFERENCE,
          },
          templates: [{id: `${TEMPLATES_REFERENCE}/alpine`, name: 'Alpine'}],
        },
        {
          sourceInformation: {ociReference: 'ghcr.io/someone/features'},
          features: KEPT_COMMUNITY_FEATURES.slice(0, 2).map(name => ({
            id: `ghcr.io/someone/features/${name}`,
            name,
          })),
        },
        {
          sourceInformation: {ociReference: 'ghcr.io/someone-else/features'},
          features: [
            {
              id: 'ghcr.io/someone-else/features/third',
              name: KEPT_COMMUNITY_FEATURES[2],
            },
          ],
        },
      ],
    });
  });

  it('tooling-61: a kept Feature of the specification that the index lacks fails, naming it', () => {
    throws(
      () => trimmedIndex(fullIndex({without: 'git'})),
      /the index has no Feature ghcr\.io\/devcontainers\/features\/git/,
    );
  });

  it('tooling-61: a kept community Feature that the index lacks fails, naming it', () => {
    throws(
      () => trimmedIndex(fullIndex({without: 'add-script'})),
      /the index has no Feature named "add-script"/,
    );
  });

  it('tooling-57: an index without that collection fails, naming it', () => {
    throws(
      () => trimmedIndex(JSON.stringify({collections: []})),
      /the index has no ghcr\.io\/devcontainers\/templates collection/,
    );
  });

  it('tooling-57: a text without collections fails', () => {
    throws(() => trimmedIndex('{}'), /the index has no collections/);
  });
});

describe('sourceNote', () => {
  it("tooling-57: the note names the URL, the date, the full file's digest and the licence beside it", () => {
    const note = sourceNote('{}', '2026-10-20');
    deepStrictEqual(
      [
        note.includes(PUBLIC_INDEX_URL),
        note.includes('downloaded on 2026-10-20'),
        note.includes(
          '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
        ),
        note.includes('`LICENSE`'),
      ],
      [true, true, true, true],
    );
  });
});
