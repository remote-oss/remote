import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {hubImage, pinnedImage} from './hub-images.ts';

/** The digest of the index of Alpine 3.22, as the harness pins it. */
const ALPINE_3_22_DIGEST =
  'sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8';

/** The files below `folder` that name `text`. */
function filesNaming(folder: string, text: string): string[] {
  return readdirSync(folder, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => path.join(entry.parentPath, entry.name))
    .filter(file => readFileSync(file, 'utf8').includes(text));
}

describe('the pinned Docker Hub images (card #3116)', () => {
  it('names an image through the mirror by its digest, with no tag, and with its tag and digest for the Docker CLI', () => {
    deepStrictEqual(
      [
        hubImage('alpine:3.22'),
        hubImage('alpine:3.20'),
        pinnedImage('alpine:3.22'),
      ],
      [
        `mirror.gcr.io/library/alpine@${ALPINE_3_22_DIGEST}`,
        'mirror.gcr.io/library/alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc',
        `alpine:3.22@${ALPINE_3_22_DIGEST}`,
      ],
    );
  });

  it('gives the digest the template fixtures hold for alpine:3.22, so a re-pin moves the fixtures with it', () => {
    const fixtures = path.join(
      import.meta.dirname,
      '..',
      'tests',
      'acceptance',
      'fixtures',
      'templates',
    );
    const named = filesNaming(fixtures, 'alpine:3.22@');
    deepStrictEqual(
      [
        named.length,
        named.every(file =>
          readFileSync(file, 'utf8').includes(pinnedImage('alpine:3.22')),
        ),
      ],
      [3, true],
    );
  });
});
