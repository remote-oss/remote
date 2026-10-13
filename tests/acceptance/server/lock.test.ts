import {deepStrictEqual} from 'node:assert';
import {runStep, type ScriptParameters} from 'lib-server';
import {startHost, type RunningHost} from './host-fixture.ts';
import {
  installFolderOf,
  lockLoop,
  parametersFor,
  placeStandInArchive,
} from './support.ts';

describe('F-2408 the lock of the host', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
    placeStandInArchive(host);
  });

  after(() => {
    host.stop();
  });

  /** Takes the install lock on the host the way a script of another window does, until `release` runs. */
  function holdLock(parameters: ScriptParameters): () => void {
    const lockFile = `${installFolderOf(parameters)}/${parameters.lock.filePrefix}.${parameters.commit}`;
    host.onHost(
      'sh',
      '-c',
      `mkdir -p '${installFolderOf(parameters)}' && : > '${lockFile}' && ln '${lockFile}' '${lockFile}.target'`,
    );
    return () => {
      host.onHost('rm', '-f', lockFile, `${lockFile}.target`);
    };
  }

  function installRun(
    parameters: ScriptParameters,
    loop = lockLoop(),
    channel = host.channel,
  ) {
    return loop(
      () =>
        runStep(
          channel,
          {installMode: 'singleScript', step: 'install'},
          parameters,
          {cancellation: new AbortController().signal},
        ),
      new AbortController().signal,
    );
  }

  function statusOf(stepRun: Awaited<ReturnType<typeof installRun>>): string {
    if (stepRun.kind === 'retriesExhausted') {
      return stepRun.kind;
    }
    return stepRun.kind === 'result' ? stepRun.block.status : stepRun.kind;
  }

  it('F-2408: answers LockBusy while another window holds the install lock', async () => {
    const parameters = parametersFor();
    const release = holdLock(parameters);
    const stepRun = await installRun(parameters, step => step());
    release();
    deepStrictEqual(statusOf(stepRun), 'LockBusy');
  });

  it('F-2408: waits for the other window and then installs', async () => {
    const parameters = parametersFor();
    const release = holdLock(parameters);
    setTimeout(release, 500);
    deepStrictEqual(statusOf(await installRun(parameters)), 'Ok');
  });

  it('F-2408: gives up after the attempts when the lock is never released', async () => {
    const parameters = parametersFor();
    const release = holdLock(parameters);
    const stepRun = await installRun(parameters, lockLoop(3, 50));
    release();
    deepStrictEqual(statusOf(stepRun), 'retriesExhausted');
  });

  it('F-2408: two windows installing at once both succeed and install once', async () => {
    const parameters = parametersFor();
    const runs = await Promise.all([
      installRun(parameters),
      installRun(parameters),
    ]);
    deepStrictEqual(
      [
        runs.map(statusOf),
        host.onHost('ls', installFolderOf(parameters)).split('\n'),
      ],
      [
        ['Ok', 'Ok'],
        ['bin', 'product.json', ''],
      ],
    );
  });

  it('F-2408: releases the lock when the install ends', async () => {
    const parameters = parametersFor();
    await installRun(parameters);
    deepStrictEqual(
      host
        .onHost('ls', '-a', installFolderOf(parameters))
        .split('\n')
        .filter(name => name.startsWith('boot-lock')),
      [],
    );
  });

  /** The facts of the server a finished install step reported, or none for any other ending. */
  function factsOf(
    stepRun: Awaited<ReturnType<typeof installRun>>,
  ): Record<string, string> {
    return stepRun.kind === 'result' ? stepRun.block.serverFacts : {};
  }

  it('#668 R4: a held lock reports the lock file', async () => {
    const parameters = parametersFor();
    const release = holdLock(parameters);
    const stepRun = await installRun(parameters, step => step());
    release();
    deepStrictEqual(
      factsOf(stepRun).lockPath,
      `${installFolderOf(parameters)}/${parameters.lock.filePrefix}.${parameters.commit}`,
    );
  });

  it('#668 R3: a lock file that cannot be opened fails at once, naming the lock file, and is not a busy lock', async () => {
    const parameters = parametersFor();
    const lockFile = `${installFolderOf(parameters)}/${parameters.lock.filePrefix}.${parameters.commit}`;
    host.onHost('mkdir', '-p', lockFile);
    try {
      const stepRun = await installRun(parameters, step => step());
      deepStrictEqual(
        [statusOf(stepRun), factsOf(stepRun).writeFailedPath],
        ['CreateInstallDirFailed', lockFile],
      );
    } finally {
      host.onHost('rm', '-rf', lockFile);
    }
  });

  it('#668 R1: an install folder the account cannot write fails naming the folder', async () => {
    const parameters = parametersFor({
      dataFolderName: '.vscodium-server-insiders',
    });
    const stepRun = await installRun(
      parameters,
      step => step(),
      host.channelOf('readonly'),
    );
    deepStrictEqual(
      [statusOf(stepRun), factsOf(stepRun).writeFailedPath],
      [
        'CreateInstallDirFailed',
        `/home/harness-ro/.vscodium-server-insiders/bin/${parameters.commit}`,
      ],
    );
  });
});
