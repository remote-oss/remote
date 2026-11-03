// A one-off measurement for tooling-116 (never merged): start the run's download host as a run does, then fetch from it
// in a container at the address clientReachOf gives.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startRunDownloads, clientReachOf, downloadHostArguments} from './acceptance-downloads.ts';
import {downloadWithRetry} from './acceptance.ts';
import {runCommand} from './command-runner.ts';
import {REPOSITORY_ROOT} from './repository.ts';

const reach = clientReachOf(process.platform, runCommand);
console.log(`reach: ${JSON.stringify(reach)}`);
const runFolder = mkdtempSync(path.join(tmpdir(), 'reach-'));
const downloads = await startRunDownloads(runCommand, downloadWithRetry, REPOSITORY_ROOT, runFolder);
const port = downloads.variables.HARNESS_DOWNLOADS_PORT;
console.log(`download host up, http port ${port}, container address ${downloads.containerAddress}`);
runCommand('docker', ['pull', '-q', 'alpine:3.22']);
// the fetch runs asynchronously: the download host answers from this process's event loop, which a synchronous spawn
// would block. Any HTTP answer proves the container reached it.
const {execFile} = await import('node:child_process');
const fetched = await new Promise<string>(resolve => {
  execFile('docker', ['run', '--rm', ...downloadHostArguments(downloads.containerAddress), 'alpine:3.22', 'sh', '-c', `wget -S -O /dev/null -T 15 http://downloads:${port}/ 2>&1; echo "wget exit $?"`], (caught, stdout, stderr) => {
    resolve(`${caught ? `docker failed: ${caught.message}\n` : ''}${stdout}${stderr}`.trim());
  });
});
console.log(`container fetch:\n${fetched}`);
await downloads.stop();
