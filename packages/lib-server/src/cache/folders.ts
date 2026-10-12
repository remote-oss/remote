/**
 * @fileoverview The V9 cache folders: where the server tree and the extension cache live on a mounted volume,
 * where the client keeps the archive of a commit, and whether two gallery addresses name the same gallery.
 * The product table decides the layout; nothing here names a product.
 */

import {keepsReferenceLayout, volumeServerFolder} from 'lib-product';

/** The keys that decide a product's cache layout: its application name and quality. */
export interface ProductKeys {
  applicationName: string;
  quality: string;
}

/** The extension cache folder: the shared folder while the product keeps the shared layout, a folder of the product's own otherwise. */
function extensionsCacheOf(applicationName: string): string {
  return keepsReferenceLayout(applicationName)
    ? '/vscode/extensionsCache'
    : `/vscode/extensionsCache-${applicationName}`;
}

/** The folders the volume serves: the server tree when a volume is mounted, and the extension cache always. */
export function cacheFolders(
  product: ProductKeys,
  commit: string,
  platform: string,
  volumeMounted: boolean,
): {serverTree: string | undefined; extensionsCache: string} {
  return {
    serverTree: volumeMounted
      ? `/vscode/${volumeServerFolder(product.applicationName)}/bin/${platform}/${commit}`
      : undefined,
    extensionsCache: extensionsCacheOf(product.applicationName),
  };
}

/** The folder under the client's cache root where the archive of the commit is kept. */
export function clientArchiveFolder(
  cacheRoot: string,
  product: ProductKeys,
  commit: string,
): string {
  const base = keepsReferenceLayout(product.applicationName)
    ? cacheRoot
    : `${cacheRoot}/${product.applicationName}`;
  return `${base}/${product.quality}/${commit}`;
}

/** A gallery address without a trailing slash. */
function withoutTrailingSlash(address: string): string {
  return address.endsWith('/') ? address.slice(0, -1) : address;
}

/** Whether two gallery addresses name the same gallery, a trailing slash on either side ignored. */
export function isFromSameGallery(
  entryGallery: string,
  productGallery: string,
): boolean {
  return (
    withoutTrailingSlash(entryGallery) === withoutTrailingSlash(productGallery)
  );
}
