import {deepStrictEqual, ok, strictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  bridgeGateway,
  type DownloadHost,
  makeCertificate,
  startDownloadHost,
} from '../../../tools/acceptance-downloads.ts';
import {runCommand} from '../../../tools/acceptance-run.ts';
import {type RunningHost, startHost} from './host-fixture.ts';

const execFileAsync = promisify(execFile);

/** What a shell command on the host printed, and its status; the run must not block while the download host answers. */
async function onHostAsync(
  container: string,
  script: string,
): Promise<{status: number; output: string}> {
  try {
    const {stdout, stderr} = await execFileAsync('docker', [
      'exec',
      '--user',
      'harness',
      container,
      'sh',
      '-c',
      script,
    ]);
    return {status: 0, output: `${stdout}${stderr}`};
  } catch (caught) {
    const failed = caught as {code?: number; stdout?: string; stderr?: string};
    return {
      status: failed.code ?? 1,
      output: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
    };
  }
}

describe('the download host as the harness host reaches it (tooling-27)', function () {
  this.timeout(120000);
  const archive = Buffer.alloc(300000, 'z');
  let folder = '';
  let logFile = '';
  let downloads: DownloadHost;
  let host: RunningHost;

  before(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'downloads-host-'));
    writeFileSync(path.join(folder, 'archive.tar.gz'), archive);
    logFile = path.join(folder, 'requests.log');
    writeFileSync(logFile, '');
    downloads = await startDownloadHost({
      addresses: ['127.0.0.1', bridgeGateway(runCommand)],
      archiveFile: path.join(folder, 'archive.tar.gz'),
      ...makeCertificate(folder),
      logFile,
    });
    host = await startHost({downloads: true});
  });

  after(async () => {
    host.stop();
    await downloads.stop();
    rmSync(folder, {recursive: true, force: true});
  });

  it('tooling-27: the host downloads the archive from the download host', async () => {
    const fetched = await onHostAsync(
      host.container,
      `wget -q -O- http://downloads:${String(downloads.httpPort)}/ok/x | wc -c`,
    );
    strictEqual(fetched.output.trim(), String(archive.length));
  });

  it('tooling-27: the host sees 404 and 503 as failures', async () => {
    const statuses = await Promise.all(
      ['missing', 'busy'].map(
        async behaviour =>
          (
            await onHostAsync(
              host.container,
              `wget -q -O /dev/null http://downloads:${String(downloads.httpPort)}/${behaviour}/x`,
            )
          ).status,
      ),
    );
    deepStrictEqual(
      statuses.map(status => status !== 0),
      [true, true],
    );
  });

  it("tooling-27: the host doesn't trust the download host's certificate, under the update service's name", async () => {
    const refused = await onHostAsync(
      host.container,
      `wget -q -O /dev/null https://update.code.visualstudio.com:${String(downloads.httpsPort)}/ok/x`,
    );
    const accepted = await onHostAsync(
      host.container,
      `wget -q --no-check-certificate -O- https://update.code.visualstudio.com:${String(downloads.httpsPort)}/ok/x | wc -c`,
    );
    deepStrictEqual(
      [
        refused.status !== 0,
        /SSL|certificate|reset/i.test(refused.output),
        accepted.output.trim(),
      ],
      [true, true, String(archive.length)],
    );
  });

  it('tooling-27: the request log names each request', () => {
    const lines = readFileSync(logFile, 'utf8');
    ok(
      ['/ok/x', '/missing/x', '/busy/x'].every(requested =>
        lines.includes(` GET ${requested} `),
      ),
    );
  });
});
