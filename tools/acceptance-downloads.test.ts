import {deepStrictEqual, ok, rejects, strictEqual} from 'node:assert';
import {createHash, X509Certificate} from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {connect, createSecureContext} from 'node:tls';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  bridgeGateway,
  BROKEN_INDEX_TEXT,
  DOWNLOAD_HOST_NAMES,
  type DownloadHost,
  downloadHostArguments,
  downloadVariables,
  DROP_HUNG_PATH,
  makeCertificate,
  requestedPlatform,
  SERVER_ARCHIVE,
  servedPlatforms,
  serverArchiveName,
  serverArchiveOf,
  startDownloadHost,
  startRunDownloads,
} from './acceptance-downloads.ts';
import {type CommandResult} from './command-runner.ts';

/** What a request got: the status, the declared length, the body received, and whether the connection broke. */
interface Received {
  status: number;
  length: number;
  body: Buffer;
  broken: boolean;
  /** The response's `Access-Control-Allow-Origin` header, or undefined when it has none. */
  allowOrigin: string | undefined;
}

/** Whether `text` parses as JSON. */
function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The body of a plain HTTP GET of `pathName` at `address` and `port`. */
function getFrom(
  address: string,
  port: number,
  pathName: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {host: address, port, path: pathName},
      response => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** Gets `pathName` from the host over HTTP or HTTPS, trusting no certificate check. */
function get(
  scheme: 'http' | 'https',
  port: number,
  pathName: string,
): Promise<Received> {
  return new Promise((resolve, reject) => {
    const send = scheme === 'http' ? httpRequest : httpsRequest;
    const outgoing = send(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        rejectUnauthorized: false,
        headers: {'user-agent': 'unit-row'},
      },
      response => {
        const chunks: Buffer[] = [];
        let broken = false;
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('aborted', () => {
          broken = true;
        });
        response.on('error', () => {
          broken = true;
        });
        response.on('close', () => {
          resolve({
            status: response.statusCode ?? 0,
            length: Number(response.headers['content-length'] ?? -1),
            body: Buffer.concat(chunks),
            broken,
            allowOrigin: response.headers['access-control-allow-origin'],
          });
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('the download host', function () {
  this.timeout(30000);
  let folder = '';
  let archive: Buffer;
  let glibcArchive: Buffer;
  let logFile = '';
  let tlsLogFile = '';
  let host: DownloadHost;

  before(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'downloads-unit-'));
    archive = Buffer.alloc(2 * 1024 * 1024 + 7, 'a');
    glibcArchive = Buffer.alloc(2 * 1024 * 1024 + 11, 'g');
    writeFileSync(path.join(folder, 'archive.tar.gz'), archive);
    writeFileSync(path.join(folder, 'glibc.tar.gz'), glibcArchive);
    logFile = path.join(folder, 'requests.log');
    tlsLogFile = path.join(folder, 'tls.log');
    writeFileSync(logFile, '');
    writeFileSync(tlsLogFile, '');
    const certificate = makeCertificate(folder);
    host = await startDownloadHost({
      addresses: ['127.0.0.1'],
      archiveFiles: {
        'alpine-x64': path.join(folder, 'archive.tar.gz'),
        'linux-x64': path.join(folder, 'glibc.tar.gz'),
      },
      defaultPlatform: 'alpine-x64',
      ...certificate,
      logFile,
      tlsLogFile,
      templatesFolder: path.join(folder, 'templates'),
      controlFolder: path.join(folder, 'control'),
    });
  });

  after(async () => {
    await host.stop();
    rmSync(folder, {recursive: true, force: true});
  });

  /** Connects to the HTTPS port asking for `servername`, trusting no certificate check unless `trusting` is false, and ends the connection. */
  function handshake(servername: string, trusting: boolean): Promise<void> {
    return new Promise(resolve => {
      const socket = connect(
        {
          host: '127.0.0.1',
          port: host.httpsPort,
          servername,
          rejectUnauthorized: !trusting,
        },
        () => {
          socket.end();
        },
      );
      socket.on('error', () => undefined);
      socket.on('close', () => {
        resolve();
      });
    });
  }

  it('tooling-51: a TLS handshake asking for github.com is logged with that name, and the request log is unchanged', async () => {
    const before = [
      readFileSync(tlsLogFile, 'utf8').split('\n').filter(Boolean).length,
      readFileSync(logFile, 'utf8'),
    ];
    await handshake('github.com', true);
    const lines = readFileSync(tlsLogFile, 'utf8').split('\n').filter(Boolean);
    deepStrictEqual(
      [
        lines.length - Number(before[0]),
        lines.at(-1)?.endsWith(' github.com'),
        readFileSync(logFile, 'utf8'),
      ],
      [1, true, before[1]],
    );
  });

  it('tooling-51: a handshake that the client refuses is logged too, and no request is logged for it', async () => {
    const before = readFileSync(logFile, 'utf8');
    await handshake('update.code.visualstudio.com', false);
    deepStrictEqual(
      [
        readFileSync(tlsLogFile, 'utf8').includes(
          ' update.code.visualstudio.com\n',
        ),
        readFileSync(logFile, 'utf8'),
      ],
      [true, before],
    );
  });

  it('tooling-27: ok gives the archive with its length', async () => {
    const received = await get('http', host.httpPort, '/ok/linux-x64/abc');
    deepStrictEqual(
      [received.status, received.length, received.body.equals(glibcArchive)],
      [200, glibcArchive.length, true],
    );
  });

  it("tooling-68: each platform's request gets its own archive, by the template's or the update service's name", async () => {
    const answers = await Promise.all(
      [
        '/ok/alpine-x64/abc',
        '/ok/linux-x64/abc',
        '/ok/commit:abc/server-linux-alpine/stable',
        '/ok/commit:abc/server-linux-x64/stable',
      ].map(async pathName => {
        const received = await get('http', host.httpPort, pathName);
        return received.body.equals(archive)
          ? 'alpine'
          : received.body.equals(glibcArchive) && 'glibc';
      }),
    );
    deepStrictEqual(answers, ['alpine', 'glibc', 'alpine', 'glibc']);
  });

  it('tooling-68: a path that names no platform gets the Alpine archive, as before', async () => {
    const received = await get('http', host.httpPort, '/ok/size/check');
    strictEqual(received.body.equals(archive), true);
  });

  it('tooling-68: a platform the run serves no archive for gives 404, from ok, cut and slow alike', async () => {
    const answers = await Promise.all(
      [
        '/ok/alpine-arm64/abc',
        '/ok/darwin-x64/abc',
        '/ok/commit:abc/server-win32-x64/stable',
        '/cut/linux-arm64/abc',
        '/slow/linux-arm64/abc',
      ].map(async pathName => {
        const received = await get('http', host.httpPort, pathName);
        return [received.status, received.body.length];
      }),
    );
    deepStrictEqual(
      answers,
      Array.from({length: 5}, () => [404, 0]),
    );
  });

  it('tooling-68: slow follows the platform asked', async () => {
    const received = await get('http', host.httpPort, '/slow/linux-x64/abc');
    strictEqual(received.body.equals(glibcArchive), true);
  });

  it('tooling-27: missing gives 404 and busy gives 503, both empty', async () => {
    const answers = await Promise.all(
      ['/missing/x', '/busy/x'].map(pathName =>
        get('http', host.httpPort, pathName),
      ),
    );
    deepStrictEqual(
      answers.map(each => [each.status, each.body.length]),
      [
        [404, 0],
        [503, 0],
      ],
    );
  });

  it('coverage-44: missing-cors gives an empty 404 with an Access-Control-Allow-Origin header, and missing gives none', async () => {
    const answers = await Promise.all(
      ['/missing-cors/x', '/missing/x'].map(pathName =>
        get('http', host.httpPort, pathName),
      ),
    );
    deepStrictEqual(
      answers.map(each => [each.status, each.body.length, each.allowOrigin]),
      [
        [404, 0, '*'],
        [404, 0, undefined],
      ],
    );
  });

  it('tooling-27: junk gives 64 KiB that are not the archive', async () => {
    const received = await get('http', host.httpPort, '/junk/x');
    deepStrictEqual(
      [received.status, received.body.length, received.body.equals(archive)],
      [200, 64 * 1024, false],
    );
  });

  it('tooling-27: cut declares the archive and breaks after 1 MiB', async () => {
    const received = await get('http', host.httpPort, '/cut/x');
    deepStrictEqual(
      [received.length, received.body.length <= 1024 * 1024, received.broken],
      [archive.length, true, true],
    );
  });

  it('tooling-27: slow sends the whole archive', async () => {
    const received = await get('http', host.httpPort, '/slow/x');
    strictEqual(received.body.equals(archive), true);
  });

  it('tooling-27: a path no behaviour names gives 404', async () => {
    strictEqual((await get('http', host.httpPort, '/other/x')).status, 404);
  });

  it("tooling-57: the template index gives 404 until the run writes it, then the run's file", async () => {
    const before = (
      await get('http', host.httpPort, '/templates/devcontainer-index.json')
    ).status;
    mkdirSync(path.join(folder, 'templates'), {recursive: true});
    writeFileSync(
      path.join(folder, 'templates', 'devcontainer-index.json'),
      '{"collections": []}',
    );
    const after = await get(
      'http',
      host.httpPort,
      '/templates/devcontainer-index.json',
    );
    deepStrictEqual(
      [before, after.status, after.body.toString()],
      [404, 200, '{"collections": []}'],
    );
  });

  it("tooling-57: broken-index.json gives an index that doesn't parse, and another templates path gives 404", async () => {
    const broken = await get(
      'http',
      host.httpPort,
      '/templates/broken-index.json',
    );
    const other = await get('http', host.httpPort, '/templates/other.json');
    deepStrictEqual(
      [
        broken.status,
        broken.body.toString(),
        parses(broken.body.toString()),
        other.status,
      ],
      [200, BROKEN_INDEX_TEXT, false, 404],
    );
  });

  it('tooling-57: unreachable drops the connection before any answer', async () => {
    await rejects(get('http', host.httpPort, '/templates/unreachable'));
  });

  it("tooling-62: the control manifest gives 404 until the run writes it, then the run's file, and another control path gives 404", async () => {
    const before = (
      await get(
        'http',
        host.httpPort,
        '/control/devcontainer-control-manifest.json',
      )
    ).status;
    mkdirSync(path.join(folder, 'control'), {recursive: true});
    writeFileSync(
      path.join(folder, 'control', 'devcontainer-control-manifest.json'),
      '{"disallowedFeatures": []}',
    );
    const after = await get(
      'http',
      host.httpPort,
      '/control/devcontainer-control-manifest.json',
    );
    const other = await get('http', host.httpPort, '/control/other.json');
    deepStrictEqual(
      [before, after.status, after.body.toString(), other.status],
      [404, 200, '{"disallowedFeatures": []}', 404],
    );
  });

  it('tooling-62: the control unreachable path drops the connection before any answer', async () => {
    await rejects(get('http', host.httpPort, '/control/unreachable'));
  });

  it('tooling-27: hang holds the request until the hung connections are dropped', async () => {
    const hung = get('http', host.httpPort, '/hang/x');
    await new Promise(resolve => setTimeout(resolve, 300));
    let settled = false;
    void hung.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise(resolve => setTimeout(resolve, 300));
    const before = settled;
    const dropped = (await get('http', host.httpPort, DROP_HUNG_PATH)).status;
    await hung.catch(() => undefined);
    deepStrictEqual([before, dropped, settled], [false, 204, true]);
  });

  it('tooling-27: the HTTPS port serves the same behaviours', async () => {
    const received = await get('https', host.httpsPort, '/ok/x');
    strictEqual(received.body.equals(archive), true);
  });

  it('tooling-27: the request log has one line per request, with the path and the user agent', () => {
    const lines = readFileSync(logFile, 'utf8').trim().split('\n');
    ok(lines.some(line => line.endsWith(' GET /ok/linux-x64/abc unit-row')));
  });

  it('tooling-27: the certificate names the download host and the update service', () => {
    const certificate = new X509Certificate(
      readFileSync(path.join(folder, 'downloads-certificate.pem')),
    );
    deepStrictEqual(
      [certificate.subjectAltName, certificate.verify(certificate.publicKey)],
      [DOWNLOAD_HOST_NAMES.map(name => `DNS:${name}`).join(', '), true],
    );
  });

  it('tooling-27: every certificate made loads into a TLS context (a minimal positive serial number)', () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const made = makeCertificate(folder);
      createSecureContext({
        cert: readFileSync(made.certificateFile),
        key: readFileSync(made.keyFile),
      });
    }
  });

  it('tooling-27: the key file is readable by its owner only', () => {
    strictEqual(
      statSync(path.join(folder, 'downloads-key.pem')).mode & 0o777,
      0o600,
    );
  });
});

describe('startDownloadHost', () => {
  it('tooling-27: an address it cannot listen on fails the start and leaves nothing listening', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'downloads-unit-'));
    try {
      const certificate = makeCertificate(folder);
      await rejects(
        startDownloadHost({
          addresses: ['127.0.0.1', '192.0.2.1'],
          archiveFiles: {'alpine-x64': path.join(folder, 'none')},
          defaultPlatform: 'alpine-x64',
          ...certificate,
          logFile: path.join(folder, 'log'),
          tlsLogFile: path.join(folder, 'tls-log'),
          templatesFolder: path.join(folder, 'templates'),
          controlFolder: path.join(folder, 'control'),
        }),
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});

describe('serverArchiveOf', () => {
  let folder = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'downloads-cache-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('tooling-27, tooling-68: names the pinned release asset of each platform', () => {
    deepStrictEqual(['alpine-arm64', 'linux-x64'].map(serverArchiveName), [
      `vscodium-reh-alpine-arm64-${SERVER_ARCHIVE.tagName}.tar.gz`,
      `vscodium-reh-linux-x64-${SERVER_ARCHIVE.tagName}.tar.gz`,
    ]);
  });

  it('tooling-68: the Alpine and the glibc server are pinned for both architectures', () => {
    deepStrictEqual(Object.keys(SERVER_ARCHIVE.sha256).sort(), [
      'alpine-arm64',
      'alpine-x64',
      'linux-arm64',
      'linux-x64',
    ]);
  });

  it('tooling-27: a platform without a pinned archive throws', async () => {
    await rejects(
      serverArchiveOf(
        folder,
        'linux-riscv64',
        () => Promise.resolve(new Uint8Array()),
        writeFileSync,
      ),
      /no server archive is pinned for linux-riscv64/,
    );
  });

  it("tooling-68: the checksums are checked per platform: one platform's download never passes as another's", async () => {
    const body = Buffer.from('fresh');
    const checksums = {
      'alpine-arm64': createHash('sha256').update(body).digest('hex'),
      'linux-arm64': createHash('sha256').update('other').digest('hex'),
    };
    const outcomes = await Promise.all(
      ['alpine-arm64', 'linux-arm64'].map(platform =>
        serverArchiveOf(
          folder,
          platform,
          () => Promise.resolve(body),
          writeFileSync,
          checksums,
        ).then(
          file => path.basename(file),
          (caught: unknown) => (caught as Error).message,
        ),
      ),
    );
    deepStrictEqual(outcomes, [
      serverArchiveName('alpine-arm64'),
      'the server archive download does not match its checksum',
    ]);
  });

  it('tooling-27: a download that does not match the checksum throws and writes nothing', async () => {
    const written: string[] = [];
    const failure = await serverArchiveOf(
      folder,
      'alpine-arm64',
      () => Promise.resolve(new Uint8Array([1, 2, 3])),
      file => written.push(file),
    ).catch((caught: unknown) => (caught as Error).message);
    deepStrictEqual(
      [failure, written],
      ['the server archive download does not match its checksum', []],
    );
  });

  it('tooling-27: a cached file whose checksum matches is used without a download', async () => {
    const file = path.join(folder, serverArchiveName('alpine-arm64'));
    writeFileSync(file, 'cached');
    const downloads: string[] = [];
    const sha256 = createHash('sha256').update('cached').digest('hex');
    const result = await serverArchiveOfPinned(sha256, folder, address => {
      downloads.push(address);
      return Promise.resolve(new Uint8Array());
    });
    deepStrictEqual([result, downloads], [file, []]);
  });

  it('tooling-27: a cached file whose checksum does not match is downloaded again and replaced', async () => {
    writeFileSync(
      path.join(folder, serverArchiveName('alpine-arm64')),
      'tampered',
    );
    const {downloads, result} = await freshDownload();
    deepStrictEqual(
      [downloads.length, readFileSync(result, 'utf8')],
      [1, 'fresh'],
    );
  });

  it('tooling-27: a missing file is downloaded from the pinned release, checked and written', async () => {
    const {downloads, result} = await freshDownload();
    deepStrictEqual(
      [downloads, readFileSync(result, 'utf8')],
      [
        [
          `https://github.com/${SERVER_ARCHIVE.repository}/releases/download/${SERVER_ARCHIVE.tagName}/${serverArchiveName('alpine-arm64')}`,
        ],
        'fresh',
      ],
    );
  });

  /** Runs serverArchiveOf with a download that answers `fresh`, pinned to its checksum; gives the addresses asked. */
  async function freshDownload(): Promise<{
    downloads: string[];
    result: string;
  }> {
    const body = Buffer.from('fresh');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const downloads: string[] = [];
    const result = await serverArchiveOfPinned(sha256, folder, address => {
      downloads.push(address);
      return Promise.resolve(body);
    });
    return {downloads, result};
  }

  /** Runs serverArchiveOf with `sha256` as the pinned arm64 checksum. */
  function serverArchiveOfPinned(
    sha256: string,
    cacheFolder: string,
    download: (address: string) => Promise<Uint8Array>,
  ): Promise<string> {
    return serverArchiveOf(
      cacheFolder,
      'alpine-arm64',
      download,
      writeFileSync,
      {'alpine-arm64': sha256},
    );
  }
});

describe('the platform a request names (card tooling-68)', () => {
  it("tooling-68: the template's <os>-<arch> and the update service's server-<platform> name it; other paths name none", () => {
    deepStrictEqual(
      [
        '/ok/alpine-x64/abc',
        '/ok/linux-arm64/abc?x=1',
        '/ok/commit:abc/server-linux-alpine/stable',
        '/ok/commit:abc/server-alpine-arm64/insider',
        '/ok/commit:abc/server-linux-x64/stable',
        '/ok/x',
        '/ok/size/check',
        '/cut/linux-x64/x',
      ].map(requestedPlatform),
      [
        'alpine-x64',
        'linux-arm64',
        'alpine-x64',
        'alpine-arm64',
        'linux-x64',
        undefined,
        undefined,
        'linux-x64',
      ],
    );
  });

  it('tooling-68: a run serves the Alpine server first, then the glibc one, of its architecture', () => {
    deepStrictEqual(servedPlatforms('arm64'), ['alpine-arm64', 'linux-arm64']);
  });
});

describe('the download host in the run', () => {
  it("tooling-27, tooling-68: a run's download host serves the cached archives on the loopback and the gateway only, and stops", async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'downloads-root-'));
    const runFolder = mkdtempSync(path.join(tmpdir(), 'downloads-run-'));
    try {
      const cache = path.join(root, '.vscode-test', 'downloads');
      mkdirSync(cache, {recursive: true});
      writeFileSync(
        path.join(cache, serverArchiveName('alpine-arm64')),
        'cached',
      );
      writeFileSync(
        path.join(cache, serverArchiveName('linux-arm64')),
        'glibc',
      );
      const downloads = await startRunDownloads(
        (): CommandResult => ({status: 0, stdout: '127.0.0.2\n', stderr: ''}),
        () => Promise.reject(new Error('no download expected')),
        root,
        runFolder,
        'arm64',
        {
          'alpine-arm64': createHash('sha256').update('cached').digest('hex'),
          'linux-arm64': createHash('sha256').update('glibc').digest('hex'),
        },
      );
      const port = Number(
        /:(\d+)$/.exec(downloads.variables.HARNESS_DOWNLOADS_LOCAL ?? '')?.[1],
      );
      const bodies = await Promise.all(
        [
          ['127.0.0.1', '/ok/x'],
          ['127.0.0.2', '/ok/x'],
          ['127.0.0.1', '/ok/linux-arm64/abc'],
        ].map(async ([address = '', pathName = '']) =>
          (await getFrom(address, port, pathName)).toString(),
        ),
      );
      const elsewhere = await getFrom('127.0.0.3', port, '/ok/x').then(
        () => 'answered',
        () => 'refused',
      );
      const hung = getFrom('127.0.0.1', port, '/hang/x').then(
        () => 'ended',
        () => 'ended',
      );
      await new Promise(resolve => setTimeout(resolve, 200));
      await downloads.stop();
      const hungEnd = await hung;
      deepStrictEqual(
        [
          elsewhere,
          hungEnd,
          bodies,
          readFileSync(
            downloads.variables.HARNESS_DOWNLOADS_LOG ?? '',
            'utf8',
          ).split('\n').length - 1,
        ],
        ['refused', 'ended', ['cached', 'cached', 'glibc'], 4],
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
      rmSync(runFolder, {recursive: true, force: true});
    }
  });

  it('tooling-27: the harness variables are the bases as the host and the editor reach them, and the log', () => {
    deepStrictEqual(
      downloadVariables(
        {httpPort: 8080, httpsPort: 8443},
        '/run/requests.log',
        '/run/downloads-tls.log',
      ),
      {
        HARNESS_DOWNLOADS_HTTP: 'http://downloads:8080',
        HARNESS_DOWNLOADS_HTTPS: 'https://downloads:8443',
        HARNESS_DOWNLOADS_LICENSED: 'https://update.code.visualstudio.com:8443',
        HARNESS_DOWNLOADS_LOCAL: 'http://127.0.0.1:8080',
        HARNESS_DOWNLOADS_LOG: '/run/requests.log',
        HARNESS_DOWNLOADS_TLS_LOG: '/run/downloads-tls.log',
      },
    );
  });

  it('tooling-27: the harness host gets both names at the bridge gateway', () => {
    deepStrictEqual(downloadHostArguments(), [
      '--add-host',
      'downloads:host-gateway',
      '--add-host',
      'update.code.visualstudio.com:host-gateway',
    ]);
  });

  it("tooling-27: the bridge gateway is read from Docker's bridge network", () => {
    const asked: string[][] = [];
    const gateway = bridgeGateway(
      (program, programArguments): CommandResult => {
        asked.push([program, ...programArguments]);
        return {status: 0, stdout: '172.17.0.1\n', stderr: ''};
      },
    );
    deepStrictEqual(
      [gateway, asked],
      [
        '172.17.0.1',
        [
          [
            'docker',
            'network',
            'inspect',
            'bridge',
            '--format',
            '{{(index .IPAM.Config 0).Gateway}}',
          ],
        ],
      ],
    );
  });
});
