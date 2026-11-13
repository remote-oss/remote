import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import path from 'node:path';

/** The port the stand-in gallery listens on; the ssh-pack launch's gallery variables name it. */
export const GALLERY_PORT = 23790;

/** The publisher of the family, and the three extensions the gallery has, by package folder. */
const PUBLISHER = 'remote-oss';
const PACKAGES: Readonly<Record<string, string>> = {
  'remote-oss.remote-ssh': 'remote-ssh',
  'remote-oss.remote-ssh-edit': 'remote-ssh-edit',
  'remote-oss.remote-explorer': 'remote-explorer',
};

/** The asset types and property keys of the gallery's wire format, as the editor's gallery service reads them. */
const MANIFEST_ASSET = 'Microsoft.VisualStudio.Code.Manifest';
const VSIX_ASSET = 'Microsoft.VisualStudio.Services.VSIXPackage';
const ENGINE_PROPERTY = 'Microsoft.VisualStudio.Code.Engine';
const PACK_PROPERTY = 'Microsoft.VisualStudio.Code.ExtensionPack';
const NAME_FILTER = 7;
const ID_FILTER = 4;

/** One request the stand-in gallery received. */
export interface GalleryRequest {
  method: string;
  url: string;
  body: string;
}

/** A running stand-in gallery and what it was asked. */
export interface StandInGallery {
  /** Every request received, in order. */
  requests(): readonly GalleryRequest[];
  /** The extension ids named by the queries received, in order, one entry per name. */
  queriedIds(): readonly string[];
  stop(): Promise<void>;
}

/** The fields of a manifest the gallery's answer is made of. */
interface ManifestFields {
  version: string;
  displayName?: string;
  description?: string;
  engines?: {vscode?: string};
  extensionPack?: string[];
}

/** An extension the gallery serves: its manifest and its packaged file. */
interface Served {
  id: string;
  version: string;
  manifest: ManifestFields;
  manifestText: string;
  vsixFile: string;
}

/** A stable identifier in the shape of a GUID, made from `text`. */
function guidOf(text: string): string {
  const digest = createHash('sha256').update(text).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

/** The extensions of the family the run packaged, read from the repository's package folders and built VSIX files. */
function servedFrom(root: string): Served[] {
  const built = readdirSync(path.join(root, 'dist'));
  return Object.entries(PACKAGES).map(([extensionId, folder]) => {
    const manifestText = readFileSync(
      path.join(root, 'packages', folder, 'package.json'),
      'utf8',
    );
    const manifest = JSON.parse(manifestText) as ManifestFields;
    const vsix = built.find(
      file => file === `${folder}-${manifest.version}.vsix`,
    );
    if (vsix === undefined) {
      throw new Error(`no packaged ${folder}-${manifest.version}.vsix in dist`);
    }
    return {
      id: extensionId,
      version: manifest.version,
      manifest,
      manifestText,
      vsixFile: path.join(root, 'dist', vsix),
    };
  });
}

/** The gallery's answer for one extension: its identity, publisher and its one version with the files and properties. */
function rawExtensionOf(served: Served, origin: string): unknown {
  const name = served.id.slice(PUBLISHER.length + 1);
  const assetUri = `${origin}/assets/${served.id}/${served.version}`;
  const engine = served.manifest.engines?.vscode;
  const pack = served.manifest.extensionPack;
  const now = new Date(0).toISOString();
  return {
    extensionId: guidOf(served.id),
    extensionName: name,
    displayName: served.manifest.displayName ?? name,
    shortDescription: served.manifest.description ?? '',
    publisher: {
      displayName: PUBLISHER,
      publisherId: guidOf(PUBLISHER),
      publisherName: PUBLISHER,
      domain: null,
      isDomainVerified: false,
    },
    versions: [
      {
        version: served.version,
        lastUpdated: now,
        assetUri,
        fallbackAssetUri: assetUri,
        files: [
          {assetType: MANIFEST_ASSET, source: `${assetUri}/${MANIFEST_ASSET}`},
          {assetType: VSIX_ASSET, source: `${assetUri}/${VSIX_ASSET}`},
        ],
        properties: [
          ...(engine === undefined
            ? []
            : [{key: ENGINE_PROPERTY, value: engine}]),
          ...(pack === undefined
            ? []
            : [{key: PACK_PROPERTY, value: pack.join(',')}]),
        ],
      },
    ],
    statistics: [],
    tags: [],
    releaseDate: now,
    publishedDate: now,
    lastUpdated: now,
    categories: [],
    flags: 'validated, public',
  };
}

/** The text of a request's body. */
async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The extension ids a query names, by name or by identifier. */
function namedIn(body: string, served: readonly Served[]): string[] {
  const parsed = JSON.parse(body === '' ? '{}' : body) as {
    filters?: Array<{criteria?: Array<{filterType: number; value?: string}>}>;
  };
  const criteria = (parsed.filters ?? []).flatMap(
    filter => filter.criteria ?? [],
  );
  const names = criteria
    .filter(each => each.filterType === NAME_FILTER)
    .map(each => String(each.value).toLowerCase());
  const identifiers = criteria
    .filter(each => each.filterType === ID_FILTER)
    .map(each => String(each.value).toLowerCase());
  return served
    .filter(
      each => names.includes(each.id) || identifiers.includes(guidOf(each.id)),
    )
    .map(each => each.id);
}

/**
 * Starts a gallery on the loopback that serves the three extensions of the family from the run's packaged files,
 * answering the editor's extension query and the downloads of their manifests and VSIX files, and records every
 * request it gets.
 */
export async function startGallery(root: string): Promise<StandInGallery> {
  const served = servedFrom(root);
  const seen: GalleryRequest[] = [];
  const asked: string[] = [];
  const origin = `http://127.0.0.1:${String(GALLERY_PORT)}`;
  const server: Server = createServer((request, response) => {
    void bodyOf(request).then(body => {
      const url = request.url ?? '';
      seen.push({method: request.method ?? '', url, body});
      if (request.method === 'POST' && url.endsWith('/extensionquery')) {
        const named = namedIn(body, served);
        asked.push(...named);
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            results: [
              {
                extensions: served
                  .filter(each => named.includes(each.id))
                  .map(each => rawExtensionOf(each, origin)),
                resultMetadata: [
                  {
                    metadataType: 'ResultCount',
                    metadataItems: [{name: 'TotalCount', count: named.length}],
                  },
                ],
              },
            ],
          }),
        );
        return;
      }
      const asset = /^\/assets\/([^/]+)\/([^/]+)\/([^/?]+)/.exec(url);
      const match = served.find(each => each.id === asset?.[1]);
      if (match === undefined) {
        response.statusCode = 404;
        response.end();
        return;
      }
      if (asset?.[3] === MANIFEST_ASSET) {
        response.setHeader('content-type', 'application/json');
        response.end(match.manifestText);
      } else if (asset?.[3] === VSIX_ASSET) {
        response.setHeader('content-type', 'application/octet-stream');
        response.end(readFileSync(match.vsixFile));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  await new Promise<void>(resolve => {
    server.listen(GALLERY_PORT, '127.0.0.1', resolve);
  });
  return {
    requests: () => seen,
    queriedIds: () => asked,
    stop: () =>
      new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
