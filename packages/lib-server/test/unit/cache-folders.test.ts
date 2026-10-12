/**
 * @fileoverview The V9 cache folders (card server-06): the table rows, one case each.
 */

import {deepStrictEqual, strict} from 'node:assert';
import {
  cacheFolders,
  clientArchiveFolder,
  isFromSameGallery,
  type ProductKeys,
} from '../../src/index.ts';

/** A product by the two keys that decide its cache layout. */
function product(applicationName: string, quality: string): ProductKeys {
  return {applicationName, quality};
}

describe('the V9 cache folders (card server-06)', () => {
  it('a mounted volume serves the server tree and the reference extension cache', () => {
    deepStrictEqual(
      cacheFolders(product('code', 'stable'), 'abc', 'linux-x64', true),
      {
        serverTree: '/vscode/vscode-server/bin/linux-x64/abc',
        extensionsCache: '/vscode/extensionsCache',
      },
    );
  });

  it('an unmounted volume serves no server tree and the same extension cache', () => {
    deepStrictEqual(
      cacheFolders(product('code', 'stable'), 'abc', 'linux-x64', false),
      {serverTree: undefined, extensionsCache: '/vscode/extensionsCache'},
    );
  });

  it('codium serves its own server tree on the volume', () => {
    deepStrictEqual(
      cacheFolders(product('codium', 'stable'), 'abc', 'linux-x64', true),
      {
        serverTree: '/vscode/codium-server/bin/linux-x64/abc',
        extensionsCache: '/vscode/extensionsCache-codium',
      },
    );
  });

  it('a synthetic editor serves its own server tree on the volume', () => {
    deepStrictEqual(
      cacheFolders(
        product('synthetic-editor', 'stable'),
        'abc',
        'linux-x64',
        true,
      ),
      {
        serverTree: '/vscode/synthetic-editor-server/bin/linux-x64/abc',
        extensionsCache: '/vscode/extensionsCache-synthetic-editor',
      },
    );
  });

  it('code-insiders keeps the reference extension cache', () => {
    deepStrictEqual(
      cacheFolders(
        product('code-insiders', 'insider'),
        'abc',
        'linux-x64',
        true,
      ).extensionsCache,
      '/vscode/extensionsCache',
    );
  });

  it('codium gets an extension cache of its own', () => {
    deepStrictEqual(
      cacheFolders(product('codium', 'stable'), 'abc', 'linux-x64', true)
        .extensionsCache,
      '/vscode/extensionsCache-codium',
    );
  });

  it('codium-insiders gets an extension cache of its own', () => {
    deepStrictEqual(
      cacheFolders(
        product('codium-insiders', 'insider'),
        'abc',
        'linux-x64',
        true,
      ).extensionsCache,
      '/vscode/extensionsCache-codium-insiders',
    );
  });

  it('a synthetic editor gets an extension cache of its own', () => {
    deepStrictEqual(
      cacheFolders(
        product('synthetic-editor', 'stable'),
        'abc',
        'linux-x64',
        true,
      ).extensionsCache,
      '/vscode/extensionsCache-synthetic-editor',
    );
  });

  it('the reference layout keeps the cache root, quality and commit', () => {
    deepStrictEqual(
      clientArchiveFolder('/c', product('code', 'stable'), 'abc'),
      '/c/stable/abc',
    );
  });

  it('code-insiders keeps the reference layout', () => {
    deepStrictEqual(
      clientArchiveFolder('/c', product('code-insiders', 'insider'), 'abc'),
      '/c/insider/abc',
    );
  });

  it('every other product gets an applicationName level under the cache root', () => {
    deepStrictEqual(
      clientArchiveFolder('/c', product('codium', 'stable'), 'abc'),
      '/c/codium/stable/abc',
    );
  });

  it('two products never share a folder unless both keep the reference layout', () => {
    deepStrictEqual(
      {
        ownFolders: [
          clientArchiveFolder('/c', product('codium', 'stable'), 'abc'),
          clientArchiveFolder(
            '/c',
            product('codium-insiders', 'stable'),
            'abc',
          ),
        ],
        referenceFolders: [
          clientArchiveFolder('/c', product('code', 'stable'), 'abc'),
          clientArchiveFolder('/c', product('code-insiders', 'stable'), 'abc'),
        ],
      },
      {
        ownFolders: ['/c/codium/stable/abc', '/c/codium-insiders/stable/abc'],
        referenceFolders: ['/c/stable/abc', '/c/stable/abc'],
      },
    );
  });

  it('a trailing slash does not separate two addresses of one gallery', () => {
    strict.equal(
      isFromSameGallery(
        'https://open-vsx.org/vscode/gallery/',
        'https://open-vsx.org/vscode/gallery',
      ),
      true,
    );
  });

  it('two different galleries are not the same', () => {
    strict.equal(
      isFromSameGallery(
        'https://marketplace.visualstudio.com/_apis/public/gallery',
        'https://open-vsx.org/vscode/gallery',
      ),
      false,
    );
  });
});
