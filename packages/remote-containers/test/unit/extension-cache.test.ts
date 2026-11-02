import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {HostChannel, ScriptRequest} from 'lib-host';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {DownloadRequest} from 'lib-server';
import {
  cacheExtensions,
  checksumAddressOf,
  engineAccepts,
  type ExtensionCacheRequest,
  galleryQueryOf,
  pickOf,
} from '../../src/connect/extension-cache.ts';

const PACKAGE =
  'https://gallery.invalid/api/acme/tool/1.2.0/file/acme.tool-1.2.0.vsix';
const CHECKSUM =
  'https://gallery.invalid/api/acme/tool/1.2.0/file/acme.tool-1.2.0.sha256';
const PACKAGE_BYTES = 'the package';

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A gallery version entry for `targetPlatform`, with the engine and pre-release flag given. */
function versionEntry(
  version: string,
  targetPlatform: string,
  engine = '^1.90.0',
  preRelease = false,
): unknown {
  return {
    version,
    targetPlatform,
    files: [
      {
        assetType: 'Microsoft.VisualStudio.Services.VSIXPackage',
        source: `https://gallery.invalid/api/acme/tool/${version}/file/acme.tool-${version}${targetPlatform === 'universal' ? '' : `@${targetPlatform}`}.vsix`,
      },
    ],
    properties: [
      {key: 'Microsoft.VisualStudio.Code.Engine', value: engine},
      ...(preRelease
        ? [{key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true'}]
        : []),
    ],
  };
}

function answerOf(...versions: unknown[]): unknown {
  return {results: [{extensions: [{versions}]}]};
}

describe('the extensions cache', () => {
  describe('the gallery', () => {
    it('F-0419: the query names the extension by its id and asks for its versions', () => {
      deepStrictEqual(galleryQueryOf('acme.tool'), {
        filters: [
          {
            criteria: [{filterType: 7, value: 'acme.tool'}],
            pageNumber: 1,
            pageSize: 1,
          },
        ],
        flags: 950,
      });
    });

    it('F-0419: an engine range accepts the product version by its form', () => {
      deepStrictEqual(
        [
          engineAccepts('*', '1.140.0'),
          engineAccepts('^1.95.0', '1.140.0'),
          engineAccepts('^1.200.0', '1.140.0'),
          engineAccepts('^2.0.0', '1.140.0'),
          engineAccepts('>=1.140.0', '1.140.06829'),
          engineAccepts('1.141.0', '1.140.0'),
          engineAccepts('latest', '1.140.0'),
          engineAccepts('^1.95.0', 'insider'),
        ],
        [true, true, false, false, true, false, false, false],
      );
    });

    it('F-0419 AC-35: the newest version for the container picks its own target over a newer one for another', () => {
      deepStrictEqual(
        pickOf(
          answerOf(
            versionEntry('1.4.0', 'win32-x64'),
            versionEntry('1.3.0', 'alpine-x64'),
            versionEntry('1.2.0', 'universal'),
          ),
          'acme.tool',
          'alpine-x64',
          '1.140.0',
        ),
        {
          id: 'acme.tool',
          version: '1.3.0',
          packageAddress:
            'https://gallery.invalid/api/acme/tool/1.3.0/file/acme.tool-1.3.0@alpine-x64.vsix',
          fileName: 'acme.tool-1.3.0-alpine-x64.vsix',
        },
      );
    });

    it('F-0419: a pre-release and a version the engine refuses are passed over for a universal one', () => {
      deepStrictEqual(
        pickOf(
          answerOf(
            versionEntry('1.5.0', 'universal', '^1.90.0', true),
            versionEntry('1.4.0', 'universal', '^1.200.0'),
            versionEntry('1.2.0', 'universal'),
          ),
          'acme.tool',
          'linux-x64',
          '1.140.0',
        )?.fileName,
        'acme.tool-1.2.0.vsix',
      );
    });

    it('F-0419: a version or target that would leave the cache folder is passed over', () => {
      deepStrictEqual(
        pickOf(
          answerOf(
            versionEntry('1.0.0/../../x', 'universal'),
            versionEntry('1.1.0', '../linux-x64'),
            versionEntry('1.0.0', 'universal'),
          ),
          'acme.tool',
          'linux-x64',
          '1.140.0',
        )?.fileName,
        'acme.tool-1.0.0.vsix',
      );
    });

    it('F-0419: an answer with nothing to install gives no pick', () => {
      deepStrictEqual(
        [
          pickOf(undefined, 'acme.tool', 'linux-x64', '1.140.0'),
          pickOf(answerOf(), 'acme.tool', 'linux-x64', '1.140.0'),
          pickOf(
            answerOf({
              version: '1.0.0',
              targetPlatform: 'universal',
              files: [],
            }),
            'acme.tool',
            'linux-x64',
            '1.140.0',
          ),
        ],
        [undefined, undefined, undefined],
      );
    });

    it('F-0419: the checksum lies beside the package, as Open VSX publishes it', () => {
      deepStrictEqual(
        [
          checksumAddressOf(PACKAGE),
          checksumAddressOf('https://gallery.invalid/assets/tool/package'),
        ],
        [CHECKSUM, undefined],
      );
    });
  });

  describe('the container script and the flow', () => {
    let root = '';

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'extension-cache-'));
    });

    afterEach(() => {
      rmSync(root, {recursive: true, force: true});
    });

    /** A container whose scripts run under `sh` and whose copies are local copies, recording both. */
    function containerOf(failCopies = false): {
      channel: HostChannel;
      copies: string[];
    } {
      const copies: string[] = [];
      return {
        copies,
        channel: {
          runScript: (request: ScriptRequest, onLine) => {
            const output = execFileSync('/bin/sh', ['-c', request.script], {
              env: {...process.env, ...request.environment},
              encoding: 'utf8',
            });
            for (const line of output.split('\n')) {
              onLine(line);
            }
            return Promise.resolve({kind: 'exited', status: 0});
          },
          copyToHost: request => {
            copies.push(request.remotePath);
            if (failCopies) {
              return Promise.resolve({
                kind: 'failed',
                failure: {kind: 'copyFailed', detail: 'no room'},
              });
            }
            copyFileSync(request.localFile, request.remotePath);
            return Promise.resolve({kind: 'copied'});
          },
          identity: () => 'container',
          platformHint: () => 'linux',
        },
      };
    }

    /** Ports whose gallery offers acme.tool 1.2.0 and whose downloads serve the package and `checksum`. */
    function portsOf(
      channel: HostChannel,
      checksum: string | 404,
      packageFails = false,
    ): {
      ports: Parameters<typeof cacheExtensions>[0];
      downloads: string[];
      sink: MemorySink;
    } {
      const downloads: string[] = [];
      const sink = new MemorySink();
      return {
        downloads,
        sink,
        ports: {
          queryGallery: () =>
            Promise.resolve(answerOf(versionEntry('1.2.0', 'universal'))),
          download: {
            download: (request: DownloadRequest) => {
              downloads.push(request.address);
              if (request.address.endsWith('.sha256')) {
                if (checksum === 404) {
                  return Promise.resolve({
                    kind: 'failed',
                    detail: 'not found',
                    cause: 'httpStatus',
                    status: 404,
                  });
                }
                writeFileSync(request.destination, `${checksum}\n`);
              } else if (packageFails) {
                return Promise.resolve({kind: 'failed', detail: 'reset'});
              } else {
                writeFileSync(request.destination, PACKAGE_BYTES);
              }
              return Promise.resolve({
                kind: 'downloaded',
                facts: {},
                finalAddress: request.address,
              });
            },
          },
          files: {
            remove: file => {
              rmSync(file, {force: true});
              return Promise.resolve();
            },
            exists: file => Promise.resolve(existsSync(file)),
            size: () => Promise.resolve(0),
            sha256: file =>
              Promise.resolve(sha256Text(readFileSync(file, 'utf8'))),
            rename: (source, destination) => {
              renameSync(source, destination);
              return Promise.resolve({kind: 'renamed'});
            },
          },
          readText: file =>
            Promise.resolve(
              existsSync(file) ? readFileSync(file, 'utf8') : undefined,
            ),
          channel,
          newTemporaryToken: () => 'token',
          logger: createLogger(sink, {minimumLevel: () => 'info'}),
        },
      };
    }

    function requestOf(shared: boolean): ExtensionCacheRequest {
      const client = path.join(root, 'client');
      mkdirSync(client, {recursive: true});
      const sharedFolder = path.join(root, 'shared');
      if (shared) {
        mkdirSync(sharedFolder, {recursive: true});
      }
      return {
        extensions: ['acme.tool'],
        serviceUrl: 'https://gallery.invalid/vscode/gallery',
        target: 'linux-x64',
        productVersion: '1.140.0',
        sharedFolder: shared ? sharedFolder : undefined,
        clientFolder: client,
        ownFolder: path.join(root, 'own'),
        queryMilliseconds: 1000,
        cancellation: new AbortController().signal,
      };
    }

    function ownFile(): string {
      return path.join(root, 'own', 'acme.tool-1.2.0.vsix');
    }

    function sharedFile(): string {
      return path.join(root, 'shared', 'acme.tool-1.2.0.vsix');
    }

    it('F-0419 AC-4: a package not yet cached is downloaded, checked, published on the volume and linked', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const installs = await cacheExtensions(ports, requestOf(true));
      deepStrictEqual(
        [
          installs,
          readFileSync(sharedFile(), 'utf8'),
          readlinkSync(ownFile()),
          execFileSync('ls', ['-A', path.join(root, 'client')], {
            encoding: 'utf8',
          }),
        ],
        [[ownFile()], PACKAGE_BYTES, sharedFile(), ''],
      );
    });

    it('F-0419 AC-5: a package the shared cache holds is linked and not downloaded again', async () => {
      const {channel} = containerOf();
      const {ports, downloads, sink} = portsOf(
        channel,
        sha256Text(PACKAGE_BYTES),
      );
      const request = requestOf(true);
      writeFileSync(sharedFile(), PACKAGE_BYTES);
      const installs = await cacheExtensions(ports, request);
      deepStrictEqual(
        [
          installs,
          downloads,
          lstatSync(ownFile()).isSymbolicLink(),
          sink.lines.some(({message: line}) =>
            line.includes('acme.tool@1.2.0 is taken from the shared cache'),
          ),
        ],
        [[ownFile()], [], true, true],
      );
    });

    it("F-0419: a package that doesn't match its checksum writes nothing and is left to the server", async () => {
      const {channel, copies} = containerOf();
      const {ports, sink} = portsOf(channel, sha256Text('another package'));
      const installs = await cacheExtensions(ports, requestOf(true));
      deepStrictEqual(
        [
          installs,
          copies,
          existsSync(sharedFile()),
          sink.lines.some(({message: line}) =>
            line.includes("doesn't match its published checksum"),
          ),
        ],
        [['acme.tool'], [], false, true],
      );
    });

    it("F-0419: with no published checksum the package isn't cached, and the log says so", async () => {
      const {channel} = containerOf();
      const {ports, downloads, sink} = portsOf(channel, 404);
      const installs = await cacheExtensions(ports, requestOf(true));
      deepStrictEqual(
        [
          installs,
          downloads,
          sink.lines.some(({message: line}) =>
            line.includes('no checksum is published for acme.tool@1.2.0'),
          ),
        ],
        [['acme.tool'], [CHECKSUM], true],
      );
    });

    it('F-0419: a checksum file that holds no digest counts as none', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, 'not a checksum');
      deepStrictEqual(await cacheExtensions(ports, requestOf(true)), [
        'acme.tool',
      ]);
    });

    it("F-0419: a package that can't be downloaded is left to the server", async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES), true);
      deepStrictEqual(await cacheExtensions(ports, requestOf(true)), [
        'acme.tool',
      ]);
    });

    it('F-0419: a copy into the volume that fails is left to the server', async () => {
      const {channel} = containerOf(true);
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      deepStrictEqual(await cacheExtensions(ports, requestOf(true)), [
        'acme.tool',
      ]);
    });

    it('F-0419: a package another container published first is kept, and this one links to it', async () => {
      const {channel} = containerOf();
      const request = requestOf(true);
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      let racedBefore = false;
      const racing = {
        ...ports,
        channel: {
          ...channel,
          copyToHost: (copy: Parameters<HostChannel['copyToHost']>[0]) => {
            if (!racedBefore) {
              racedBefore = true;
              writeFileSync(sharedFile(), 'published first');
            }
            return channel.copyToHost(copy);
          },
        },
      };
      const installs = await cacheExtensions(racing, request);
      deepStrictEqual(
        [installs, readFileSync(ownFile(), 'utf8')],
        [[ownFile()], 'published first'],
      );
    });

    it('F-0419 AC-39: with no volume the client keeps the package and the container gets a copy', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const request = requestOf(false);
      const installs = await cacheExtensions(ports, request);
      deepStrictEqual(
        [
          installs,
          readFileSync(
            path.join(request.clientFolder, 'acme.tool-1.2.0.vsix'),
            'utf8',
          ),
          lstatSync(ownFile()).isSymbolicLink(),
          readFileSync(ownFile(), 'utf8'),
        ],
        [[ownFile()], PACKAGE_BYTES, false, PACKAGE_BYTES],
      );
    });

    it('F-0419: with no volume a package the client keeps is copied and not downloaded again', async () => {
      const {channel} = containerOf();
      const {ports, downloads} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const request = requestOf(false);
      writeFileSync(
        path.join(request.clientFolder, 'acme.tool-1.2.0.vsix'),
        PACKAGE_BYTES,
      );
      deepStrictEqual(
        [await cacheExtensions(ports, request), downloads],
        [[ownFile()], []],
      );
    });

    it('F-0419: with no volume a copy into the container that fails is left to the server', async () => {
      const {channel} = containerOf(true);
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      deepStrictEqual(await cacheExtensions(ports, requestOf(false)), [
        'acme.tool',
      ]);
    });

    it('F-0419: an extension the gallery offers nothing of is left to the server, and the log says so', async () => {
      const {channel} = containerOf();
      const {ports, sink} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const installs = await cacheExtensions(
        {...ports, queryGallery: () => Promise.resolve(undefined)},
        requestOf(true),
      );
      deepStrictEqual(
        [
          installs,
          sink.lines.some(({message: line}) =>
            line.includes(
              'the gallery offers no version of acme.tool for linux-x64',
            ),
          ),
        ],
        [['acme.tool'], true],
      );
    });

    it("F-0505: an entry that isn't a plain gallery id, a pinned version included, is left to the server unasked", async () => {
      const {channel} = containerOf();
      const {ports, sink} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      let queries = 0;
      const installs = await cacheExtensions(
        {
          ...ports,
          queryGallery: () => {
            queries += 1;
            return Promise.resolve(undefined);
          },
        },
        {...requestOf(true), extensions: ['acme.tool@1.0.0', '../acme.tool']},
      );
      deepStrictEqual(
        [
          installs,
          queries,
          sink.lines.filter(({message}) =>
            message.includes("isn't a plain gallery id"),
          ).length,
        ],
        [['acme.tool@1.0.0', '../acme.tool'], 0, 2],
      );
    });

    it("F-0419: a gallery that doesn't answer in time leaves the extension to the server", async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const started = Date.now();
      const installs = await cacheExtensions(
        {
          ...ports,
          queryGallery: (...[, , cancellation]) =>
            new Promise(resolve => {
              cancellation.addEventListener('abort', () => {
                resolve(undefined);
              });
            }),
        },
        {...requestOf(true), queryMilliseconds: 20},
      );
      deepStrictEqual(
        [installs, Date.now() - started < 1000],
        [['acme.tool'], true],
      );
    });

    it('F-0419: a container script that fails to run counts as nothing cached', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const failing = {
        ...ports,
        channel: {
          ...channel,
          runScript: () =>
            Promise.resolve({
              kind: 'failed' as const,
              failure: {kind: 'channelClosed' as const, detail: 'gone'},
            }),
        },
      };
      deepStrictEqual(await cacheExtensions(failing, requestOf(true)), [
        'acme.tool',
      ]);
    });
  });
});
