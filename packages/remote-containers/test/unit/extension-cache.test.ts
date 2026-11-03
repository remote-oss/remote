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
  cacheInBackground,
  planExtensions,
  reasonOf,
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
          engineAccepts('>=1.140.0', '1.140.0'),
          engineAccepts('^1.140.5', '1.140.0'),
          engineAccepts('>=2.0.0', '1.140.0'),
          engineAccepts('>=0.9.0', '1.140.0'),
          engineAccepts('1.141.0', '1.140.0'),
          engineAccepts('latest', '1.140.0'),
          engineAccepts('^1.95.0', 'insider'),
        ],
        [
          true,
          true,
          false,
          false,
          true,
          true,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
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

    it('F-0505 AC-2: a pinned version is the only one taken', () => {
      deepStrictEqual(
        [
          pickOf(
            answerOf(
              versionEntry('1.3.0', 'universal'),
              versionEntry('1.2.0', 'universal'),
            ),
            'acme.tool',
            'linux-x64',
            '1.140.0',
            '1.2.0',
          )?.fileName,
          pickOf(
            answerOf(versionEntry('1.3.0', 'universal')),
            'acme.tool',
            'linux-x64',
            '1.140.0',
            '1.2.0',
          ),
        ],
        ['acme.tool-1.2.0.vsix', undefined],
      );
    });

    it('F-0419: a version that names no target is universal', () => {
      deepStrictEqual(
        pickOf(
          answerOf({
            version: '1.0.0',
            files: [
              {
                assetType: 'Microsoft.VisualStudio.Services.VSIXPackage',
                source: PACKAGE,
              },
            ],
          }),
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
      ports: Parameters<typeof planExtensions>[0];
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
              request.onPercent(100);
              if (request.authorizationFor(request.address) !== undefined) {
                return Promise.resolve({kind: 'failed', detail: 'authorized'});
              }
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

    /** Plans the extensions, then runs the background step to its end, and gives the plan's installs. */
    async function plannedAndCached(
      ports: Parameters<typeof planExtensions>[0],
      request: ExtensionCacheRequest,
    ): Promise<string[]> {
      const plan = await planExtensions(ports, request);
      await cacheInBackground(
        ports,
        request,
        plan.pending,
        new AbortController().signal,
      );
      return plan.installs;
    }

    function ownFile(): string {
      return path.join(root, 'own', 'acme.tool-1.2.0.vsix');
    }

    function sharedFile(): string {
      return path.join(root, 'shared', 'acme.tool-1.2.0.vsix');
    }

    it('F-0419 AC-4, AC-17: a package not yet cached goes to the server as its id, and the background step downloads, checks, publishes and links it', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const installs = await plannedAndCached(ports, requestOf(true));
      deepStrictEqual(
        [
          installs,
          readFileSync(sharedFile(), 'utf8'),
          readlinkSync(ownFile()),
          execFileSync('ls', ['-A', path.join(root, 'client')], {
            encoding: 'utf8',
          }),
        ],
        [['acme.tool'], PACKAGE_BYTES, sharedFile(), ''],
      );
    });

    it('F-0505 AC-2: a pinned version is cached as that version', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      deepStrictEqual(
        [
          await plannedAndCached(ports, {
            ...requestOf(true),
            extensions: ['acme.tool@1.2.0'],
          }),
          readFileSync(sharedFile(), 'utf8'),
        ],
        [['acme.tool@1.2.0'], PACKAGE_BYTES],
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
      const installs = await plannedAndCached(ports, request);
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
      const installs = await plannedAndCached(ports, requestOf(true));
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
      const installs = await plannedAndCached(ports, requestOf(true));
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
      deepStrictEqual(await plannedAndCached(ports, requestOf(true)), [
        'acme.tool',
      ]);
    });

    it("F-0419: a checksum that can't be read counts as none", async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      deepStrictEqual(
        await plannedAndCached(
          {...ports, readText: () => Promise.resolve(undefined)},
          requestOf(true),
        ),
        ['acme.tool'],
      );
    });

    it('F-0419: a package address with no .vsix ending has no checksum beside it', async () => {
      const {channel} = containerOf();
      const {ports, downloads} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const installs = await plannedAndCached(
        {
          ...ports,
          queryGallery: () =>
            Promise.resolve(
              answerOf({
                version: '1.2.0',
                targetPlatform: 'universal',
                files: [
                  {
                    assetType: 'Microsoft.VisualStudio.Services.VSIXPackage',
                    source: 'https://gallery.invalid/assets/acme/tool/package',
                  },
                ],
              }),
            ),
        },
        requestOf(true),
      );
      deepStrictEqual([installs, downloads], [['acme.tool'], []]);
    });

    it('F-0419: with no volume a kept package whose copy into the container fails is left to the server', async () => {
      const {channel} = containerOf(true);
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const request = requestOf(false);
      writeFileSync(
        path.join(request.clientFolder, 'acme.tool-1.2.0.vsix'),
        PACKAGE_BYTES,
      );
      deepStrictEqual(await plannedAndCached(ports, request), ['acme.tool']);
    });

    it("F-0419: with no volume a package the client can't keep is left to the server", async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      deepStrictEqual(
        await plannedAndCached(
          {
            ...ports,
            files: {
              ...ports.files,
              rename: () =>
                Promise.resolve({kind: 'failed', detail: 'no room'}),
            },
          },
          requestOf(false),
        ),
        ['acme.tool'],
      );
    });

    it("F-0419: a package that can't be downloaded is left to the server", async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES), true);
      deepStrictEqual(await plannedAndCached(ports, requestOf(true)), [
        'acme.tool',
      ]);
    });

    it('F-0419: a copy into the volume that fails is left to the server', async () => {
      const {channel} = containerOf(true);
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      deepStrictEqual(await plannedAndCached(ports, requestOf(true)), [
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
      const installs = await plannedAndCached(racing, request);
      deepStrictEqual(
        [installs, readFileSync(ownFile(), 'utf8')],
        [['acme.tool'], 'published first'],
      );
    });

    it('F-0419 AC-39: with no volume the client keeps the package and the container gets a copy', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const request = requestOf(false);
      const installs = await plannedAndCached(ports, request);
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
        [['acme.tool'], PACKAGE_BYTES, false, PACKAGE_BYTES],
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
        [await plannedAndCached(ports, request), downloads],
        [[ownFile()], []],
      );
    });

    it('F-0419: with no volume a copy into the container that fails is left to the server', async () => {
      const {channel} = containerOf(true);
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      deepStrictEqual(await plannedAndCached(ports, requestOf(false)), [
        'acme.tool',
      ]);
    });

    it('F-0419: an extension the gallery offers nothing of is left to the server, and the log says so', async () => {
      const {channel} = containerOf();
      const {ports, sink} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const installs = await plannedAndCached(
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
      const installs = await plannedAndCached(
        {
          ...ports,
          queryGallery: () => {
            queries += 1;
            return Promise.resolve(undefined);
          },
        },
        {
          ...requestOf(true),
          extensions: [
            'acme.tool@prerelease',
            '../acme.tool',
            'acme.tool@1.0.0@x',
          ],
        },
      );
      deepStrictEqual(
        [
          installs,
          queries,
          sink.lines.filter(({message}) =>
            message.includes("isn't a plain gallery id or pinned version"),
          ).length,
        ],
        [['acme.tool@prerelease', '../acme.tool', 'acme.tool@1.0.0@x'], 0, 3],
      );
    });

    it("F-0419: a gallery that doesn't answer in time leaves the extension to the server", async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const started = Date.now();
      const installs = await plannedAndCached(
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
      deepStrictEqual(await plannedAndCached(failing, requestOf(true)), [
        'acme.tool',
      ]);
    });

    it('F-0419 AC-17: the plan downloads nothing, so an uncached extension is installed by the server after it starts', async () => {
      const {channel} = containerOf();
      const {ports, downloads} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const plan = await planExtensions(ports, requestOf(true));
      deepStrictEqual(
        [plan.installs, plan.pending.map(pick => pick.fileName), downloads],
        [['acme.tool'], ['acme.tool-1.2.0.vsix'], []],
      );
    });

    it('F-0419 AC-5: after the background step a second container takes the package from the cache as its path', async () => {
      const {channel} = containerOf();
      const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const first = await plannedAndCached(ports, requestOf(true));
      rmSync(path.join(root, 'own'), {recursive: true, force: true});
      const second = await planExtensions(ports, requestOf(true));
      deepStrictEqual(
        [first, second.installs, second.pending],
        [['acme.tool'], [ownFile()], []],
      );
    });

    it('F-0419: the background step never replaces an entry the server wrote in the container’s cache, with a volume or without', async () => {
      const seen: unknown[] = [];
      for (const shared of [true, false]) {
        rmSync(path.join(root, 'own'), {recursive: true, force: true});
        rmSync(path.join(root, 'shared'), {recursive: true, force: true});
        rmSync(path.join(root, 'client'), {recursive: true, force: true});
        const {channel, copies} = containerOf();
        const {ports} = portsOf(channel, sha256Text(PACKAGE_BYTES));
        const request = requestOf(shared);
        const plan = await planExtensions(ports, request);
        mkdirSync(path.join(root, 'own'), {recursive: true});
        writeFileSync(ownFile(), 'the server wrote this');
        await cacheInBackground(
          ports,
          request,
          plan.pending,
          new AbortController().signal,
        );
        seen.push([
          lstatSync(ownFile()).isSymbolicLink(),
          readFileSync(ownFile(), 'utf8'),
          shared ? readFileSync(sharedFile(), 'utf8') : copies.length,
        ]);
      }
      deepStrictEqual(seen, [
        [false, 'the server wrote this', PACKAGE_BYTES],
        [false, 'the server wrote this', 0],
      ]);
    });

    it('F-0419: the background step stops when the connection ends, and when its time runs out, each with one log line', async () => {
      const {channel} = containerOf();
      const {ports, downloads, sink} = portsOf(
        channel,
        sha256Text(PACKAGE_BYTES),
      );
      const request = requestOf(true);
      const plan = await planExtensions(ports, request);
      const ended = new AbortController();
      ended.abort();
      await cacheInBackground(ports, request, plan.pending, ended.signal);
      const afterEnded = [...downloads];
      await cacheInBackground(
        {
          ...ports,
          download: {
            download: download =>
              new Promise(resolve => {
                download.cancellation.addEventListener('abort', () => {
                  resolve({kind: 'failed', detail: 'cancelled'});
                });
              }),
          },
        },
        request,
        [...plan.pending, ...plan.pending],
        new AbortController().signal,
        10,
      );
      deepStrictEqual(
        [
          afterEnded,
          sink.lines
            .map(({message}) => message)
            .filter(message =>
              message.startsWith('the extensions cache stopped'),
            ),
        ],
        [
          [],
          [
            'the extensions cache stopped before acme.tool@1.2.0: the connection ended',
            'the extensions cache stopped before acme.tool@1.2.0: its time ran out',
          ],
        ],
      );
    });

    it('F-0419: an error inside the background step is one log line, and the step goes on to the next', async () => {
      const {channel} = containerOf();
      const {ports, sink} = portsOf(channel, sha256Text(PACKAGE_BYTES));
      const request = requestOf(true);
      const plan = await planExtensions(ports, request);
      await cacheInBackground(
        {
          ...ports,
          newTemporaryToken: () => {
            throw new Error('no token');
          },
        },
        request,
        [...plan.pending, ...plan.pending],
        new AbortController().signal,
      );
      deepStrictEqual(
        sink.lines
          .map(({message}) => message)
          .filter(message => message.includes('could not be cached')),
        [
          'the extension acme.tool@1.2.0 could not be cached: no token',
          'the extension acme.tool@1.2.0 could not be cached: no token',
        ],
      );
    });

    it('F-0419: a log line gives an error’s message, or the thrown value itself', () => {
      deepStrictEqual(
        [reasonOf(new Error('no token')), reasonOf('plain'), reasonOf(7)],
        ['no token', 'plain', '7'],
      );
    });
  });
});
