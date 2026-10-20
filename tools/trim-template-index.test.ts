/**
 * @fileoverview The cut of the public template index into the run's pinned snapshot.
 */

import {deepStrictEqual, throws} from 'node:assert';
import {
  PUBLIC_INDEX_URL,
  sourceNote,
  TEMPLATES_REFERENCE,
  trimmedIndex,
} from './trim-template-index.ts';

/** A small index in the public one's shape: a Features collection, the specification's templates, and another collection. */
const FULL_INDEX = JSON.stringify({
  collections: [
    {
      sourceInformation: {ociReference: 'ghcr.io/devcontainers/features'},
      features: [{id: 'ghcr.io/devcontainers/features/git'}],
      templates: [],
    },
    {
      sourceInformation: {name: 'Templates', ociReference: TEMPLATES_REFERENCE},
      features: [{id: 'a feature of the templates collection'}],
      templates: [{id: `${TEMPLATES_REFERENCE}/alpine`, name: 'Alpine'}],
    },
    {
      sourceInformation: {ociReference: 'ghcr.io/someone/templates'},
      templates: [{id: 'ghcr.io/someone/templates/thing'}],
    },
  ],
});

describe('trimmedIndex', () => {
  it("tooling-57: only the specification's template collection is kept, with its source and templates and no Features", () => {
    deepStrictEqual(JSON.parse(trimmedIndex(FULL_INDEX)), {
      collections: [
        {
          sourceInformation: {
            name: 'Templates',
            ociReference: TEMPLATES_REFERENCE,
          },
          templates: [{id: `${TEMPLATES_REFERENCE}/alpine`, name: 'Alpine'}],
        },
      ],
    });
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
