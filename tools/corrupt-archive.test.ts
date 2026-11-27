import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {
  brokerUrlOf,
  corruptArchiveLines,
  corruptArchiveName,
  failingDownload,
  probeArchive,
  probeText,
  secondBuildText,
} from '../tests/acceptance/windows/corrupt-archive.ts';

describe('the corrupt archive of a Feature download (card #2675)', () => {
  it('#2675: a log with SDKMAN’s verdict gives the download, the verdict and the attempts, trimmed', () => {
    deepStrictEqual(
      corruptArchiveLines([
        '#14 60.01 Installing java',
        '#14 64.43 Downloading: maven 3.10.1  ',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
      ]),
      [
        '#14 64.43 Downloading: maven 3.10.1',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
      ],
    );
  });

  it('#2675: a failed build without the verdict gives nothing, even with a download in it', () => {
    deepStrictEqual(
      corruptArchiveLines([
        '#14 64.43 Downloading: maven 3.10.1',
        '#14 64.95 ERROR: Feature "Java (via SDKMAN!)" failed to install!',
      ]),
      [],
    );
  });

  it('#2675: a verdict that SDKMAN recovered from, followed by another failure, gives nothing', () => {
    deepStrictEqual(
      corruptArchiveLines([
        '#14 64.43 Downloading: maven 3.10.1',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 70.10 Downloading: maven 3.10.1',
        '#14 80.00 ERROR: Feature "Java (via SDKMAN!)" failed to install!',
      ]),
      [],
    );
  });

  it('#2675: an empty log gives nothing', () => {
    deepStrictEqual(corruptArchiveLines([]), []);
  });

  it('#2675: the fault is named for the reader of the red, with the candidate, its version and SDKMAN’s verdict', () => {
    deepStrictEqual(
      corruptArchiveName([
        '#14 64.43 Downloading: maven 3.10.1  ',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
      ]),
      'SDKMAN served a corrupt maven 3.10.1 archive (Stop! The archive was corrupt and has been removed!)',
    );
  });

  it('#2675: a build that downloaded the JDK and then maven is named for maven, the download its last verdict follows, and not for the first download of the log', () => {
    const lines = [
      '#14 7.51 Downloading: java 27.0.1.1+4-tem',
      '#14 26.83 Downloading: maven 3.10.2',
      '#14 27.37 Stop! The archive was corrupt and has been removed! Please try installing again.',
      '#14 37.40 Downloading: maven 3.10.2',
      '#14 37.90 Stop! The archive was corrupt and has been removed! Please try installing again.',
      '#14 38.00 (!) Installing maven  via SDKMAN failed after 5 attempts.',
    ];
    deepStrictEqual(
      [failingDownload(lines), corruptArchiveName(lines)],
      [
        'maven 3.10.2',
        'SDKMAN served a corrupt maven 3.10.2 archive (Stop! The archive was corrupt and has been removed!)',
      ],
    );
  });

  it('#2675: a corrupt archive that SDKMAN recovered from, before the one it gave up on, does not name the first archive', () => {
    deepStrictEqual(
      failingDownload([
        '#14 7.51 Downloading: java 27.0.1.1+4-tem',
        '#14 8.20 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 18.30 Downloading: java 27.0.1.1+4-tem',
        '#14 40.00 Downloading: maven 3.10.2',
        '#14 40.50 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 41.00 (!) Installing maven  via SDKMAN failed after 5 attempts.',
      ]),
      'maven 3.10.2',
    );
  });

  it('#2675: a log with no corrupt archive has no failing download', () => {
    deepStrictEqual(
      failingDownload(['#14 64.43 Downloading: maven 3.10.1']),
      undefined,
    );
  });

  it('#2675: a log without the corrupt archive has no name', () => {
    deepStrictEqual(
      corruptArchiveName(['#14 64.43 Downloading: maven 3.10.1']),
      undefined,
    );
  });

  it('#2675: the broker address is built from the candidate and its version, and from nothing else', () => {
    deepStrictEqual(
      [
        brokerUrlOf('maven 3.10.1', 'x64'),
        brokerUrlOf('maven'),
        brokerUrlOf('a b c'),
      ],
      [
        'https://api.sdkman.io/2/broker/download/maven/3.10.1/linuxx64',
        undefined,
        undefined,
      ],
    );
  });

  it('#2675: a probe of an address that answers with something that is no zip says its status, size, type, address and the zip test', async () => {
    const server = createServer((incoming, response) => {
      incoming.resume();
      response.writeHead(200, {'content-type': 'text/html'});
      response.end('<html>refused</html>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/x`;
    try {
      const probe = await probeArchive(url);
      deepStrictEqual(
        [
          probe.status,
          probe.size,
          probe.type,
          probe.url,
          /zip|End-of-central|cannot find/iu.test(probe.zipTest),
        ],
        ['200', 20, 'text/html', url, true],
      );
    } finally {
      server.close();
    }
  });

  it('#2675: a probe of an address that redirects says what the broker answered before it and the digest of what it led to', async () => {
    const server = createServer((incoming, response) => {
      incoming.resume();
      if (incoming.url === '/broker') {
        response.writeHead(302, {
          location: '/body',
          'x-sdkman-checksum-sha-256': 'abc',
        });
        response.end();
        return;
      }
      response.writeHead(200, {'content-type': 'application/zip'});
      response.end('body');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/broker`;
    try {
      const probe = await probeArchive(url);
      deepStrictEqual(
        [probe.broker, probe.digest],
        [
          '302; location: /body; x-sdkman-checksum-sha-256: abc',
          createHash('sha256').update('body').digest('hex'),
        ],
      );
    } finally {
      server.close();
    }
  });

  it('#2675: a probe of an address nobody listens on does not throw and says the request failed', async () => {
    const probe = await probeArchive('http://127.0.0.1:1/x');
    deepStrictEqual(probeText(probe).includes('the request failed'), true);
  });

  it('#2675: the broker address of an ARM machine names the ARM platform', () => {
    deepStrictEqual(
      brokerUrlOf('maven 3.10.1', 'arm64'),
      'https://api.sdkman.io/2/broker/download/maven/3.10.1/linuxarm64',
    );
  });

  it('#2675: a second build with the verdict too is blamed on the third party', () => {
    deepStrictEqual(
      secondBuildText({
        firstName: 'the name',
        featureRow: 'the-row',
        first: ['one'],
        second: ['two'],
        secondMessage: 'it failed',
      }),
      "the name and so did the second build of the-row; this is the third party's fault, not the product's. First: one. Second: two. it failed",
    );
  });

  it('#2675: a second build that failed for another reason is not blamed on the third party', () => {
    deepStrictEqual(
      secondBuildText({
        firstName: undefined,
        featureRow: 'the-row',
        first: ['one'],
        second: [],
        secondMessage: 'it failed',
      }).includes("third party's fault"),
      false,
    );
  });
});
