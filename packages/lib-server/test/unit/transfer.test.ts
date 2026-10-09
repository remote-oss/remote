import {deepStrictEqual, rejects} from 'node:assert';
import path from 'node:path';
import type {ChannelFailure} from 'lib-host';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  RecordingChannel,
  type CopyAnswer,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {
  type ArchiveCache,
  type DownloadBounds,
  type DownloadPlan,
  type DownloadRequest,
  type DownloadResult,
  type HostLockLoop,
  RESULT_BEGIN,
  RESULT_END,
  transfer,
  type TransferOutcome,
  type TransferPhase,
  type Verification,
} from '../../src/index.ts';
import {parametersFor} from './fake-host.ts';

const ADDRESS = 'https://download.example.invalid/server.tar.gz';

const CLIENT_FOLDER = '/client/tmp';

const HOST_FOLDER = '/host/tmp';

const INSTALL_FOLDER = '/home/user/.server-data/bin/abc123';

const TOKEN = 'token1';

const ARCHIVE_NAME = `server-abc123-1700000000000-${TOKEN}.tar.gz`;

const LOCAL_FILE = path.join(CLIENT_FOLDER, ARCHIVE_NAME);

const REMOTE_COPY = `${HOST_FOLDER}/${ARCHIVE_NAME}`;

const IN_PLACE = '/mnt/client/server.tar.gz';

const NEVER_CANCELLED = new AbortController().signal;

/** Short, so that a stalled channel ends a test quickly. */
const TEST_DEADLINE_MILLISECONDS = 30;

const DOWNLOADED: DownloadResult = {
  kind: 'downloaded',
  facts: {},
  finalAddress: ADDRESS,
};

/** An answer that never ends, as a stalled channel gives. */
const STALLED: ScriptAnswer = {
  interpreter: 'posixShell',
  matches: () => true,
  lines: [],
  ending: {kind: 'holdUntilCancelled'},
};

const BOUNDS = {
  deadlineMilliseconds: 30_000,
  stallMilliseconds: 5000,
  maximumBytes: 1_000_000,
};

const KEPT = '/client/cache/abc123/server.tar.gz';

const TEMPORARY = `${KEPT}_1700000000000-${TOKEN}`;

const CHANNEL_CLOSED: ChannelFailure = {
  kind: 'channelClosed',
  detail: 'Connection closed.',
};

function block(status: string, ...facts: string[]): string[] {
  return [RESULT_BEGIN, `status=${status}`, ...facts, RESULT_END];
}

const INSTALLED = block('Ok', `server.installDir=${INSTALL_FOLDER}`);

function plan(overrides: Partial<DownloadPlan> = {}): DownloadPlan {
  return {
    kind: 'download',
    where: 'host',
    clientFallback: false,
    address: ADDRESS,
    installFolder: INSTALL_FOLDER,
    dataFolder: '/home/user/.server-data',
    launcher: 'bin/launcher',
    lockPlace: INSTALL_FOLDER,
    notes: [],
    ...overrides,
  };
}

function answering(output: readonly string[]): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: () => true,
    lines: output,
    ending: {kind: 'exit', status: 0},
  };
}

/** The loop that runs the step once. */
function runOnce(step: Parameters<HostLockLoop>[0]): ReturnType<HostLockLoop> {
  return step();
}

/** What a run of the transfer leaves to look at. */
interface TransferRun {
  outcome: TransferOutcome;
  phases: TransferPhase[];
  channel: RecordingChannel;
  downloads: DownloadRequest[];
  removed: string[];
  /** The renames of the client files, as `from -> to`. */
  renames: string[];
  /** The log lines of the transfer, as `level message`. */
  logLines: string[];
}

/** What a run is set up with: each install run's output in order, and how the client side behaves. */
interface Setup {
  plan?: Partial<DownloadPlan>;
  installs?: ReadonlyArray<readonly string[]>;
  /** Scripted answers that replace the install outputs. */
  answers?: readonly ScriptAnswer[];
  downloadResults?: readonly DownloadResult[];
  percents?: readonly number[];
  inPlace?: boolean;
  copies?: readonly CopyAnswer[];
  lockLoop?: HostLockLoop;
  cancellation?: AbortSignal;
  /** Makes the download port throw instead of answering. */
  downloadRejects?: boolean;
  /** Makes deleting a client file fail. */
  removeRejects?: boolean;
  cache?: ArchiveCache;
  token?: string;
  /** Replaces the commit of the script parameters. */
  commit?: string;
  bounds?: DownloadBounds;
  /** Makes the download port take the request and never answer. */
  downloadNever?: boolean;
  verification?: readonly Verification[];
  /** The client files that exist before the transfer. */
  existing?: readonly string[];
  /** A client file that exists once the transfer has renamed something, as when another window renamed first. */
  appearsAfterRename?: string;
  /** The sizes and SHA-256 digests the client files have. */
  sizes?: Readonly<Record<string, number>>;
  digests?: Readonly<Record<string, string>>;
  /** How a rename of a client file ends; it succeeds when absent. */
  renameResult?: {kind: 'renamed'} | {kind: 'failed'; detail: string};
  /** Collects the deleted client files even when the transfer throws. */
  removed?: string[];
}

async function runTransfer(setup: Setup = {}): Promise<TransferRun> {
  const channel = new RecordingChannel({
    identity: 'host',
    platformHint: 'linux',
    scripts: setup.answers ?? (setup.installs ?? [INSTALLED]).map(answering),
    copies: setup.copies ?? [{matches: () => true, ending: {kind: 'copied'}}],
    hostPaths: new Map(
      setup.inPlace === true
        ? [[setup.cache?.kind === 'kept' ? KEPT : LOCAL_FILE, IN_PLACE]]
        : [],
    ),
  });
  const phases: TransferPhase[] = [];
  const downloads: DownloadRequest[] = [];
  const removed = setup.removed ?? [];
  const renames: string[] = [];
  const sink = new MemorySink();
  const results = [...(setup.downloadResults ?? [DOWNLOADED])];
  const outcome = await transfer(
    {
      plan: plan(setup.plan),
      parameters: {
        ...parametersFor(),
        ...(setup.commit === undefined ? {} : {commit: setup.commit}),
      },
      clientFolder: CLIENT_FOLDER,
      downloadBounds: setup.bounds ?? BOUNDS,
      temporaryToken: setup.token ?? TOKEN,
      cache: setup.cache ?? {kind: 'none'},
      verification: setup.verification ?? ['none'],
      hostFolder: HOST_FOLDER,
      cancellation: setup.cancellation ?? NEVER_CANCELLED,
      discardDeadlineMilliseconds: TEST_DEADLINE_MILLISECONDS,
    },
    {
      channel,
      download: {
        download: request => {
          downloads.push(request);
          if (setup.downloadNever === true) {
            return new Promise<DownloadResult>(() => undefined);
          }
          if (setup.downloadRejects === true) {
            return Promise.reject(new Error('port crashed'));
          }
          for (const percent of setup.percents ?? []) {
            request.onPercent(percent);
          }
          return Promise.resolve(results.shift() ?? DOWNLOADED);
        },
      },
      files: {
        remove: file => {
          removed.push(file);
          return setup.removeRejects === true
            ? Promise.reject(new Error('file is busy'))
            : Promise.resolve();
        },
        exists: file =>
          Promise.resolve(
            (setup.existing?.includes(file) ?? false) ||
              (renames.length > 0 && setup.appearsAfterRename === file),
          ),
        size: file => Promise.resolve(setup.sizes?.[file] ?? 0),
        sha256: file => Promise.resolve(setup.digests?.[file] ?? ''),
        rename: (source, destination) => {
          renames.push(`${source} -> ${destination}`);
          return Promise.resolve(setup.renameResult ?? {kind: 'renamed'});
        },
      },
      lockLoop: setup.lockLoop ?? runOnce,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
      onPhase: phase => {
        phases.push(phase);
      },
    },
  );
  return {
    outcome,
    phases,
    channel,
    downloads,
    removed,
    renames,
    logLines: sink.lines.map(line => `${line.level} ${line.message}`),
  };
}

/** The text of every script the channel ran, in order. */
function scriptsOf(channel: RecordingChannel): string[] {
  return channel.calls.flatMap(call =>
    call.operation === 'runScript' ? [call.request.script] : [],
  );
}

/** The install scripts, which hold the lock functions the discard script lacks. */
function installsOf(channel: RecordingChannel): string[] {
  return scriptsOf(channel).filter(script => script.includes('lock_take'));
}

/** The scripts that only delete a copied archive. */
function discardsOf(channel: RecordingChannel): string[] {
  return scriptsOf(channel).filter(script => !script.includes('lock_take'));
}

/** The files the channel was asked to copy, as `local -> remote`. */
function copiesOf(channel: RecordingChannel): string[] {
  return channel.calls.flatMap(call =>
    call.operation === 'copyToHost'
      ? [`${call.request.localFile} -> ${call.request.remotePath}`]
      : [],
  );
}

function failureOf(outcome: TransferOutcome): unknown {
  return outcome.kind === 'failed' ? outcome.failure : outcome;
}

const FALLBACK = {clientFallback: true} as const;

/** The copies of a run whose copy ends in this failure. */
function copiesFailing(failure: ChannelFailure): CopyAnswer[] {
  return [{matches: () => true, ending: {kind: 'fail', failure}}];
}

describe('a download on the host (F-2403, F-2405.BR-2)', () => {
  it('F-2403: the host downloads and unpacks the archive, and the install folder is reported', async () => {
    deepStrictEqual((await runTransfer()).outcome, {
      kind: 'transferred',
      installFolder: INSTALL_FOLDER,
    });
  });

  it('F-2403: the install folder comes from the plan when the script reports none', async () => {
    const {outcome} = await runTransfer({installs: [block('Ok')]});
    deepStrictEqual(outcome, {
      kind: 'transferred',
      installFolder: INSTALL_FOLDER,
    });
  });

  it('F-2405.AC-2: a host that downloads needs no client download', async () => {
    deepStrictEqual((await runTransfer({plan: FALLBACK})).downloads, []);
  });

  it('F-2405.AC-2: the phases of a host download are downloading only', async () => {
    deepStrictEqual((await runTransfer()).phases, [{kind: 'downloading'}]);
  });

  it('F-3902.6: the script gets the plan address as the archive URL', async () => {
    const {channel} = await runTransfer();
    deepStrictEqual(
      scriptsOf(channel).map(script =>
        script.includes(`ARCHIVE_URL='${ADDRESS}'`),
      ),
      [true],
    );
  });

  it('F-3902.6: the host script keeps no archive path and removes nothing', async () => {
    const {channel} = await runTransfer();
    deepStrictEqual(
      scriptsOf(channel).map(
        script =>
          script.includes("ARCHIVE_PATH=''") &&
          script.includes("ARCHIVE_REMOVE='no'"),
      ),
      [true],
    );
  });

  it('F-2403: the unpack percentages of the script become progress phases', async () => {
    const {phases} = await runTransfer({
      installs: [
        [
          'remote-oss-server-progress unpack 50',
          'remote-oss-server-progress unpack 100',
          ...INSTALLED,
        ],
      ],
    });
    deepStrictEqual(phases.slice(1), [
      {kind: 'progress', step: 'unpack', percent: 50},
      {kind: 'progress', step: 'unpack', percent: 100},
    ]);
  });
});

describe('the fallback from the host to the client (F-2405.BR-2, BR-4)', () => {
  const FAILING_HOST_RUNS = [
    ['ServerDownloadFailed', 'ServerDownloadFailed'],
    ['NoDownloaderAvailable', 'NoDownloaderAvailable'],
    ['UnpackFailed', 'UnpackFailed'],
  ] as const;
  for (const [name, status] of FAILING_HOST_RUNS) {
    it(`F-2405.BR-2: a host that answers ${name} is followed by a client download`, async () => {
      const {outcome} = await runTransfer({
        plan: FALLBACK,
        installs: [block(status), INSTALLED],
      });
      deepStrictEqual(outcome.kind, 'transferred');
    });
  }

  it('F-2405.AC-1: the phases of a fallback are downloading, downloading locally, copying, installing', async () => {
    const {phases} = await runTransfer({
      plan: FALLBACK,
      installs: [block('ServerDownloadFailed'), INSTALLED],
    });
    deepStrictEqual(
      phases.map(phase => phase.kind),
      ['downloading', 'downloadingLocally', 'copying', 'installing'],
    );
  });

  it('F-2405.BR-4: with no fallback a failed host download is final', async () => {
    const {outcome} = await runTransfer({
      installs: [block('ServerDownloadFailed')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'downloadFailed',
    });
  });

  it('F-2405.BR-4: with no fallback no client download happens', async () => {
    const {downloads} = await runTransfer({
      installs: [block('ServerDownloadFailed')],
    });
    deepStrictEqual(downloads, []);
  });

  it('F-2402: with no fallback a host without a downloader says so', async () => {
    const {outcome} = await runTransfer({
      installs: [block('NoDownloaderAvailable')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'noDownloader',
    });
  });

  it('F-2405.7.E9: an archive the client got and the host cannot unpack is not retried on the host', async () => {
    const {channel} = await runTransfer({
      plan: {where: 'client', clientFallback: false},
      installs: [block('UnpackFailed')],
    });
    deepStrictEqual(scriptsOf(channel).length, 1);
  });

  it('F-2405.7.E9: an archive the client got and the host cannot unpack is an unpack failure', async () => {
    const {outcome} = await runTransfer({
      plan: {where: 'client', clientFallback: true},
      installs: [block('UnpackFailed')],
    });
    deepStrictEqual(failureOf(outcome), {kind: 'unpack'});
  });
});

describe('a download on the client (F-2405.BR-3, BR-5)', () => {
  const CLIENT = {where: 'client'} as const;

  it('F-2405.BR-3: the client downloads the plan address to its temporary folder', async () => {
    const {downloads} = await runTransfer({plan: CLIENT});
    deepStrictEqual(
      downloads.map(request => [request.address, request.destination]),
      [[ADDRESS, LOCAL_FILE]],
    );
  });

  it('F-2405.BR-3: the host makes no download of its own', async () => {
    const {channel} = await runTransfer({plan: CLIENT});
    deepStrictEqual(
      scriptsOf(channel).map(script => script.includes("ARCHIVE_PATH=''")),
      [false],
    );
  });

  it('F-2405.5.0: the archive is copied to the host temporary folder', async () => {
    const {channel} = await runTransfer({plan: CLIENT});
    deepStrictEqual(copiesOf(channel), [`${LOCAL_FILE} -> ${REMOTE_COPY}`]);
  });

  it('F-2405.5.0: the install reads the copied archive and removes it', async () => {
    const {channel} = await runTransfer({plan: CLIENT});
    deepStrictEqual(
      scriptsOf(channel).map(
        script =>
          script.includes(`ARCHIVE_PATH='${REMOTE_COPY}'`) &&
          script.includes("ARCHIVE_REMOVE='yes'"),
      ),
      [true],
    );
  });

  it('F-2405.5.0: the phases are downloading locally, copying, installing', async () => {
    const {phases} = await runTransfer({plan: CLIENT});
    deepStrictEqual(
      phases.map(phase => phase.kind),
      ['downloadingLocally', 'copying', 'installing'],
    );
  });

  it('F-2405.5.0: the download percentages become progress phases', async () => {
    const {phases} = await runTransfer({plan: CLIENT, percents: [10, 100]});
    deepStrictEqual(phases.slice(1, 3), [
      {kind: 'progress', step: 'download', percent: 10},
      {kind: 'progress', step: 'download', percent: 100},
    ]);
  });

  it('F-3902.6: the client archive is deleted after a successful install', async () => {
    const {removed} = await runTransfer({plan: CLIENT});
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('F-3902.6: the client archive is deleted after a failed install', async () => {
    const {removed} = await runTransfer({
      plan: CLIENT,
      installs: [block('UnpackFailed')],
    });
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('F-3902.6: the client archive is deleted after a failed download', async () => {
    const {removed} = await runTransfer({
      plan: CLIENT,
      downloadResults: [{kind: 'failed', detail: 'Failed to fetch'}],
    });
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('F-2405.7.E3: a failed client download carries the text of the failure', async () => {
    const {outcome} = await runTransfer({
      plan: CLIENT,
      downloadResults: [{kind: 'failed', detail: 'Server returned 404'}],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'localDownload',
      detail: 'Server returned 404',
    });
  });

  it('F-2405.7.E3: after a failed client download nothing is copied', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      downloadResults: [{kind: 'failed', detail: 'Failed to fetch'}],
    });
    deepStrictEqual(copiesOf(channel), []);
  });

  it('F-2405.7.E3: with no fallback a failed client download runs nothing on the host', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      downloadResults: [{kind: 'failed', detail: 'Failed to fetch'}],
    });
    deepStrictEqual(scriptsOf(channel), []);
  });

  it('F-6301.BR-7: a failed client download falls back to a download on the host', async () => {
    const {outcome} = await runTransfer({
      plan: {...CLIENT, ...FALLBACK},
      downloadResults: [{kind: 'failed', detail: 'Failed to fetch'}],
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('F-6301.BR-7: after that fallback the host script downloads from the address', async () => {
    const {channel} = await runTransfer({
      plan: {...CLIENT, ...FALLBACK},
      downloadResults: [{kind: 'failed', detail: 'Failed to fetch'}],
    });
    deepStrictEqual(
      scriptsOf(channel).map(script => script.includes("ARCHIVE_PATH=''")),
      [true],
    );
  });
});

describe('the client file read in place by the host (F-6301 6.7)', () => {
  const IN_PLACE_SETUP: Setup = {plan: {where: 'client'}, inPlace: true};

  it('F-6301.6.7: no copy is made', async () => {
    const {channel} = await runTransfer(IN_PLACE_SETUP);
    deepStrictEqual(copiesOf(channel), []);
  });

  it('F-6301.6.7: the install reads the path the host gave and keeps the file', async () => {
    const {channel} = await runTransfer(IN_PLACE_SETUP);
    deepStrictEqual(
      scriptsOf(channel).map(
        script =>
          script.includes(`ARCHIVE_PATH='${IN_PLACE}'`) &&
          script.includes("ARCHIVE_REMOVE='no'"),
      ),
      [true],
    );
  });

  it('F-6301.6.7: the phases have no copying', async () => {
    const {phases} = await runTransfer(IN_PLACE_SETUP);
    deepStrictEqual(
      phases.map(phase => phase.kind),
      ['downloadingLocally', 'installing'],
    );
  });

  it('F-6301.6.7: the client file is still deleted when the transfer ends', async () => {
    const {removed} = await runTransfer(IN_PLACE_SETUP);
    deepStrictEqual(removed, [LOCAL_FILE]);
  });
});

describe('failures of the copy and the install (V4)', () => {
  const CLIENT = {where: 'client'} as const;

  function copyFailing(failure: ChannelFailure): Setup {
    return {plan: CLIENT, copies: copiesFailing(failure)};
  }

  const COPY_FAILURE: ChannelFailure = {
    kind: 'copyToolMissing',
    detail: 'scp: not found',
  };

  it('V4: a failed copy carries the failure of the channel', async () => {
    const {outcome} = await runTransfer(copyFailing(COPY_FAILURE));
    deepStrictEqual(failureOf(outcome), {kind: 'copy', failure: COPY_FAILURE});
  });

  it('V4: a cancelled copy is a cancellation', async () => {
    const {outcome} = await runTransfer(
      copyFailing({kind: 'cancelled', detail: 'stopped'}),
    );
    deepStrictEqual(failureOf(outcome), {kind: 'cancelled'});
  });

  it('V4: a failed copy does not start the install', async () => {
    const {channel} = await runTransfer(copyFailing(COPY_FAILURE));
    deepStrictEqual(installsOf(channel), []);
  });

  it('V4: a cancelled client download is a cancellation', async () => {
    const {outcome} = await runTransfer({
      plan: CLIENT,
      downloadResults: [{kind: 'cancelled'}],
    });
    deepStrictEqual(failureOf(outcome), {kind: 'cancelled'});
  });

  it('V4: a cancelled download does not fall back to the host', async () => {
    const {channel} = await runTransfer({
      plan: {...CLIENT, ...FALLBACK},
      downloadResults: [{kind: 'cancelled'}],
    });
    deepStrictEqual(scriptsOf(channel), []);
  });

  it('V4: a cancelled install run is a cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('window closed'));
    const {outcome} = await runTransfer({cancellation: controller.signal});
    deepStrictEqual(failureOf(outcome), {kind: 'cancelled'});
  });

  it('V4: a closed channel is a channel failure', async () => {
    const {outcome} = await runTransfer({
      answers: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: [],
          ending: {kind: 'fail', failure: CHANNEL_CLOSED},
        },
      ],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'channelFailed',
      failure: CHANNEL_CLOSED,
    });
  });

  it('V4: an output with no result block is a failure of that name', async () => {
    const {outcome} = await runTransfer({installs: [['no block here']]});
    deepStrictEqual(failureOf(outcome), {kind: 'noResultBlock'});
  });

  it('V4: any other status of the script is a script failure', async () => {
    const {outcome} = await runTransfer({
      installs: [block('CreateInstallDirFailed')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'scriptFailed',
      status: 'CreateInstallDirFailed',
    });
  });

  it('F-2408.BR-3: a host lock that stays busy ends in retries exhausted', async () => {
    const {outcome} = await runTransfer({
      lockLoop: () => Promise.resolve('retriesExhausted'),
    });
    deepStrictEqual(failureOf(outcome), {kind: 'retriesExhausted'});
  });
});

describe('the client file is deleted on every path (F-3902.6)', () => {
  const CLIENT = {where: 'client'} as const;

  it('V4: after a cancelled download', async () => {
    const {removed} = await runTransfer({
      plan: CLIENT,
      downloadResults: [{kind: 'cancelled'}],
    });
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('V4: after a failed copy', async () => {
    const {removed} = await runTransfer({
      plan: CLIENT,
      copies: copiesFailing({kind: 'copyFailed', detail: 'no space'}),
    });
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('V4: after a cancelled copy', async () => {
    const {removed} = await runTransfer({
      plan: CLIENT,
      copies: copiesFailing({kind: 'cancelled', detail: 'stopped'}),
    });
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('V4: after a download port that throws', async () => {
    const removed: string[] = [];
    await runTransfer({plan: CLIENT, downloadRejects: true, removed}).catch(
      () => undefined,
    );
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('V4: a download port that throws is not hidden', async () => {
    await rejects(runTransfer({plan: CLIENT, downloadRejects: true}), {
      message: 'port crashed',
    });
  });

  it('V4: a file that cannot be deleted does not turn a success into a failure', async () => {
    const {outcome} = await runTransfer({plan: CLIENT, removeRejects: true});
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('V4: a file that cannot be deleted does not change the kind of a failure', async () => {
    const {outcome} = await runTransfer({
      plan: CLIENT,
      removeRejects: true,
      installs: [block('UnpackFailed')],
    });
    deepStrictEqual(failureOf(outcome), {kind: 'unpack'});
  });
});

describe('the copy left on the host is deleted (V4)', () => {
  const CLIENT = {where: 'client'} as const;

  const CLOSED: ScriptAnswer = {
    interpreter: 'posixShell',
    matches: () => true,
    lines: [],
    ending: {kind: 'fail', failure: CHANNEL_CLOSED},
  };

  function deletes(scripts: readonly string[]): boolean[] {
    return scripts.map(script =>
      script.includes(`ARCHIVE_PATH='${REMOTE_COPY}'`),
    );
  }

  it('V4: after a failed copy, whose partial file is the likeliest to be large', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      copies: copiesFailing({kind: 'copyFailed', detail: 'no space'}),
    });
    deepStrictEqual(deletes(discardsOf(channel)), [true]);
  });

  it('V4: after a channel that closed during the install', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      answers: [CLOSED, answering(INSTALLED)],
    });
    deepStrictEqual(deletes(discardsOf(channel)), [true]);
  });

  it('V4: after an install that printed no result block', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      installs: [['no block here'], INSTALLED],
    });
    deepStrictEqual(deletes(discardsOf(channel)), [true]);
  });

  it('V4: after a host lock that stayed busy through every retry', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      lockLoop: () => Promise.resolve('retriesExhausted'),
    });
    deepStrictEqual(deletes(discardsOf(channel)), [true]);
  });

  it('V4: after a cancelled install, with a signal of its own', async () => {
    const controller = new AbortController();
    const {channel} = await runTransfer({
      plan: CLIENT,
      answers: [
        {
          ...CLOSED,
          ending: {
            kind: 'fail',
            failure: {kind: 'cancelled', detail: 'window closed'},
          },
        },
        answering(INSTALLED),
      ],
      cancellation: controller.signal,
    });
    deepStrictEqual(deletes(discardsOf(channel)), [true]);
  });

  it('V4: not after a status the script reported, because the script deleted the file itself', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      installs: [block('UnpackFailed')],
    });
    deepStrictEqual(discardsOf(channel), []);
  });

  it('V4: not after a success', async () => {
    const {channel} = await runTransfer({plan: CLIENT});
    deepStrictEqual(discardsOf(channel), []);
  });

  it('V4: not for a file the host reads in place', async () => {
    const {channel} = await runTransfer({
      plan: CLIENT,
      inPlace: true,
      answers: [CLOSED, answering(INSTALLED)],
    });
    deepStrictEqual(discardsOf(channel), []);
  });

  it('V4: not for a download on the host', async () => {
    const {channel} = await runTransfer({
      answers: [CLOSED, answering(INSTALLED)],
    });
    deepStrictEqual(discardsOf(channel), []);
  });

  it('R-79: a stalled channel does not hold the result back, and the leftover is logged with its full name', async () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const {outcome, logLines} = await runTransfer({
      plan: CLIENT,
      commit,
      copies: copiesFailing({kind: 'cancelled', detail: 'stopped'}),
      answers: [STALLED],
    });
    deepStrictEqual(
      [failureOf(outcome), logLines],
      [
        {kind: 'cancelled'},
        [
          `info downloaded from ${ADDRESS}`,
          `warn copied archive left at ${HOST_FOLDER}/server-${commit}-1700000000000-${TOKEN}.tar.gz`,
        ],
      ],
    );
  });

  it('V4: a deletion that works logs no warning', async () => {
    const {logLines} = await runTransfer({
      plan: CLIENT,
      copies: copiesFailing({kind: 'copyFailed', detail: 'no space'}),
    });
    deepStrictEqual(
      logLines.filter(line => line.startsWith('warn')),
      [],
    );
  });
});

describe('the kept cache (F-6301.BR-4, BR-5, BR-14)', () => {
  const KEEP: Setup = {
    plan: {where: 'client'},
    cache: {kind: 'kept', archivePath: KEPT},
  };

  it('F-6301.BR-5: the download goes to a temporary name beside the cache entry', async () => {
    const {downloads} = await runTransfer(KEEP);
    deepStrictEqual(
      downloads.map(request => request.destination),
      [TEMPORARY],
    );
  });

  it('F-6301.BR-5: the download is renamed into the cache once it is checked', async () => {
    const {renames} = await runTransfer(KEEP);
    deepStrictEqual(renames, [`${TEMPORARY} -> ${KEPT}`]);
  });

  it('F-6301.BR-4: the cache entry is the file that is copied to the host', async () => {
    const {channel} = await runTransfer(KEEP);
    deepStrictEqual(copiesOf(channel), [`${KEPT} -> ${REMOTE_COPY}`]);
  });

  it('F-6301.BR-4: the cache entry is not deleted when the transfer ends', async () => {
    const {removed} = await runTransfer(KEEP);
    deepStrictEqual(removed, [TEMPORARY]);
  });

  it('F-6301.BR-4: an entry already in the cache is used without a download', async () => {
    const {downloads} = await runTransfer({...KEEP, existing: [KEPT]});
    deepStrictEqual(downloads, []);
  });

  it('F-6301.BR-4: an entry already in the cache is copied to the host', async () => {
    const {channel} = await runTransfer({...KEEP, existing: [KEPT]});
    deepStrictEqual(copiesOf(channel), [`${KEPT} -> ${REMOTE_COPY}`]);
  });

  it('F-6301.BR-4: an entry already in the cache is left in place afterwards', async () => {
    const {removed} = await runTransfer({...KEEP, existing: [KEPT]});
    deepStrictEqual(removed, []);
  });

  it('F-6301.BR-4: an entry already in the cache shows no download phase', async () => {
    const {phases} = await runTransfer({...KEEP, existing: [KEPT]});
    deepStrictEqual(
      phases.map(phase => phase.kind),
      ['copying', 'installing'],
    );
  });

  it('F-6301.6.7: a cache entry the host reads in place is not copied', async () => {
    const {channel} = await runTransfer({...KEEP, inPlace: true});
    deepStrictEqual(copiesOf(channel), []);
  });

  it('F-6301.BR-14: a window that loses the rename to another uses the entry that won', async () => {
    const {outcome} = await runTransfer({
      ...KEEP,
      renameResult: {kind: 'failed', detail: 'target exists'},
      appearsAfterRename: KEPT,
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('F-6301.BR-5: a rename that fails without leaving an entry is a download failure', async () => {
    const {outcome} = await runTransfer({
      ...KEEP,
      renameResult: {kind: 'failed', detail: 'disk is read-only'},
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'localDownload',
      detail: 'disk is read-only',
    });
  });
});

describe('the check of a download (F-6301.BR-6)', () => {
  const KEEP: Setup = {
    plan: {where: 'client'},
    cache: {kind: 'kept', archivePath: KEPT},
  };
  const ANNOUNCED = 'ab12';

  function announcing(facts: {
    announcedSha256?: string;
    announcedLength?: number;
  }): DownloadResult {
    return {kind: 'downloaded', facts, finalAddress: ADDRESS};
  }

  const KEPT_MISMATCH: Setup = {
    ...KEEP,
    verification: ['headerHash'],
    downloadResults: [announcing({announcedSha256: ANNOUNCED})],
    digests: {[TEMPORARY]: 'ffff'},
  };

  const NOT_KEPT_MISMATCH: Setup = {
    plan: {where: 'client'},
    verification: ['headerHash'],
    downloadResults: [announcing({announcedSha256: ANNOUNCED})],
    digests: {[LOCAL_FILE]: 'ffff'},
  };

  it('F-6301.AC-12: a body that does not match the announced checksum is a checksum failure', async () => {
    const {outcome} = await runTransfer({
      ...KEEP,
      verification: ['headerHash', 'lengthOnly'],
      downloadResults: [announcing({announcedSha256: ANNOUNCED})],
      digests: {[TEMPORARY]: 'ffff'},
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'verification',
      mismatch: 'checksum',
    });
  });

  it('F-6301.AC-12: a body that does not match is not renamed into the cache', async () => {
    const {renames} = await runTransfer(KEPT_MISMATCH);
    deepStrictEqual(renames, []);
  });

  it('F-6301.AC-12: a body that does not match is deleted', async () => {
    const {removed} = await runTransfer(KEPT_MISMATCH);
    deepStrictEqual(removed, [TEMPORARY]);
  });

  /** The failure of a kept download whose body is shorter than the length the response announced. */
  async function shortBodyFailure(
    rules: readonly Verification[],
  ): Promise<unknown> {
    const {outcome} = await runTransfer({
      ...KEEP,
      verification: rules,
      downloadResults: [announcing({announcedLength: 100})],
      sizes: {[TEMPORARY]: 60},
    });
    return failureOf(outcome);
  }

  const LENGTH_FAILURE = {kind: 'verification', mismatch: 'length'};

  it('F-6301.AC-13: a body shorter than the announced length is a length failure', async () => {
    deepStrictEqual(await shortBodyFailure(['lengthOnly']), LENGTH_FAILURE);
  });

  it('F-6301.BR-6: a body that matches the announced checksum is kept', async () => {
    const {renames} = await runTransfer({
      ...KEEP,
      verification: ['headerHash'],
      downloadResults: [announcing({announcedSha256: ANNOUNCED.toUpperCase()})],
      digests: {[TEMPORARY]: ANNOUNCED},
    });
    deepStrictEqual(renames, [`${TEMPORARY} -> ${KEPT}`]);
  });

  it('F-6301.BR-12: with no announced checksum the length decides', async () => {
    deepStrictEqual(
      await shortBodyFailure(['headerHash', 'lengthOnly']),
      LENGTH_FAILURE,
    );
  });

  it('F-6301.7.E4: a failed check falls back to a download on the host when the plan allows it', async () => {
    const {outcome} = await runTransfer({
      ...KEEP,
      plan: {where: 'client', clientFallback: true},
      verification: ['headerHash'],
      downloadResults: [announcing({announcedSha256: ANNOUNCED})],
      digests: {[TEMPORARY]: 'ffff'},
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('V4: a download that is not kept is checked too', async () => {
    const {outcome} = await runTransfer(NOT_KEPT_MISMATCH);
    deepStrictEqual(failureOf(outcome), {
      kind: 'verification',
      mismatch: 'checksum',
    });
  });

  it('V4: a download that is not kept is deleted after a failed check', async () => {
    const {removed} = await runTransfer(NOT_KEPT_MISMATCH);
    deepStrictEqual(removed, [LOCAL_FILE]);
  });
});

describe('the bounds of a download (R-79)', () => {
  const CLIENT: Setup = {plan: {where: 'client'}};

  function failing(cause: 'stalled' | 'deadline' | 'tooLarge'): DownloadResult {
    return {kind: 'failed', detail: '', cause};
  }

  it('R-79: the request carries the deadline, the stall time and the size ceiling', async () => {
    const {downloads} = await runTransfer(CLIENT);
    deepStrictEqual(
      downloads.map(request => [
        request.deadlineMilliseconds,
        request.stallMilliseconds,
        request.maximumBytes,
      ]),
      [[30_000, 5000, 1_000_000]],
    );
  });

  it('R-79: the request names the hosts the download may end on', async () => {
    const {downloads} = await runTransfer({
      plan: {
        where: 'client',
        address: 'https://github.com/example/releases/download/1/server.tar.gz',
      },
    });
    deepStrictEqual(
      downloads.map(request => request.allowedHosts),
      [
        [
          'github.com',
          'objects.githubusercontent.com',
          'release-assets.githubusercontent.com',
        ],
      ],
    );
  });

  it('R-79: a body longer than the ceiling is too large even when the port did not say so', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      sizes: {[LOCAL_FILE]: BOUNDS.maximumBytes + 1},
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'tooLarge',
    });
  });

  it('R-79: a body exactly at the ceiling is accepted', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      sizes: {[LOCAL_FILE]: BOUNDS.maximumBytes},
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('R-79: a download that stalled is a timeout of that reason', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [failing('stalled')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'downloadTimeout',
      reason: 'stalled',
    });
  });

  it('R-79: a deadline the port reports is a timeout of that reason', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [failing('deadline')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'downloadTimeout',
      reason: 'deadline',
    });
  });

  it('R-79: a stalled client download falls back to the host when the plan allows it', async () => {
    const {outcome} = await runTransfer({
      plan: {where: 'client', clientFallback: true},
      downloadResults: [failing('stalled')],
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('R-79: a body that overran is a server download failure of the size', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [failing('tooLarge')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'tooLarge',
    });
  });

  it('R-79: a body that overran does not fall back to the host', async () => {
    const {channel} = await runTransfer({
      plan: {where: 'client', clientFallback: true},
      downloadResults: [failing('tooLarge')],
    });
    deepStrictEqual(scriptsOf(channel), []);
  });

  it('R-79: a port that never answers ends at the deadline', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadNever: true,
      bounds: {...BOUNDS, deadlineMilliseconds: 30},
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'downloadTimeout',
      reason: 'deadline',
    });
  });

  it('R-79: a port that never answers is told to stop at the deadline', async () => {
    const {downloads} = await runTransfer({
      ...CLIENT,
      downloadNever: true,
      bounds: {...BOUNDS, deadlineMilliseconds: 30},
    });
    deepStrictEqual(
      downloads.map(request => request.cancellation.aborted),
      [true],
    );
  });

  it('R-79: a port that never answers still has its file deleted', async () => {
    const {removed} = await runTransfer({
      ...CLIENT,
      downloadNever: true,
      bounds: {...BOUNDS, deadlineMilliseconds: 30},
    });
    deepStrictEqual(removed, [LOCAL_FILE]);
  });

  it('R-79: a cancellation of the caller ends a port that never answers as a cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('window closed'));
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadNever: true,
      cancellation: controller.signal,
    });
    deepStrictEqual(failureOf(outcome), {kind: 'cancelled'});
  });
});

describe('the host of the final response (contracts V4, redirects)', () => {
  const CLIENT: Setup = {plan: {where: 'client'}};
  const GITHUB = 'https://github.com/example/releases/download/1/server.tar.gz';

  function endingAt(finalAddress: string): DownloadResult {
    return {kind: 'downloaded', facts: {}, finalAddress};
  }

  it('V4: a response from the source host is accepted', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt(`${ADDRESS}?token=1`)],
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('V4: a response from another host is a server download failure of the redirect', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt('https://elsewhere.example.invalid/x')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'redirectHost',
    });
  });

  it('V4: release assets of github.com may come from the hosts the table lists', async () => {
    const {outcome} = await runTransfer({
      plan: {where: 'client', address: GITHUB},
      downloadResults: [
        endingAt('https://release-assets.githubusercontent.com/x'),
      ],
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('V4: a host the table does not list for github.com is refused', async () => {
    const {outcome} = await runTransfer({
      plan: {where: 'client', address: GITHUB},
      downloadResults: [endingAt('https://cdn.example.invalid/x')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'redirectHost',
    });
  });

  it('V4: a final address that is not an address is refused', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt('not an address')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'redirectHost',
    });
  });

  it('V4: a download from https must not end over http on the source host', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [
        endingAt('http://download.example.invalid/server.tar.gz'),
      ],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'redirectHost',
    });
  });

  it('V4: a download from https must not end over http on a host the table lists', async () => {
    const {outcome} = await runTransfer({
      plan: {where: 'client', address: GITHUB},
      downloadResults: [
        endingAt('http://release-assets.githubusercontent.com/x'),
      ],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'redirectHost',
    });
  });

  it('V4: a download from http may end over http', async () => {
    const address = 'http://download.example.invalid/server.tar.gz';
    const {outcome} = await runTransfer({
      plan: {where: 'client', address},
      downloadResults: [endingAt(address)],
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('V4: a download from http may end over https', async () => {
    const {outcome} = await runTransfer({
      plan: {where: 'client', address: 'http://download.example.invalid/x'},
      downloadResults: [endingAt('https://download.example.invalid/x')],
    });
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('V4: a final address of another scheme is refused', async () => {
    const {outcome} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt('ftp://download.example.invalid/x')],
    });
    deepStrictEqual(failureOf(outcome), {
      kind: 'serverDownload',
      cause: 'redirectHost',
    });
  });

  it('V4: the log has the origin and path of the final address, not its query', async () => {
    const {logLines} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt(`${ADDRESS}?sig=abc&expires=1`)],
    });
    deepStrictEqual(logLines, [`info downloaded from ${ADDRESS}`]);
  });

  it('V4: the log has no fragment and no user name of the final address', async () => {
    const {logLines} = await runTransfer({
      ...CLIENT,
      downloadResults: [
        endingAt(
          'https://user:secret@download.example.invalid/server.tar.gz#frag',
        ),
      ],
    });
    deepStrictEqual(logLines, [`info downloaded from ${ADDRESS}`]);
  });

  it('V4: a final address that is not an address is logged as such', async () => {
    const {logLines} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt('not an address')],
    });
    deepStrictEqual(logLines, ['info downloaded from (not an address)']);
  });

  it('V4: the final address is logged', async () => {
    const {logLines} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt('https://elsewhere.example.invalid/x')],
    });
    deepStrictEqual(logLines, [
      'info downloaded from https://elsewhere.example.invalid/x',
    ]);
  });

  it('V4: a refused host does not fall back to the host download', async () => {
    const {channel} = await runTransfer({
      plan: {where: 'client', clientFallback: true},
      downloadResults: [endingAt('https://elsewhere.example.invalid/x')],
    });
    deepStrictEqual(scriptsOf(channel), []);
  });

  it('V4: a refused download is deleted', async () => {
    const {removed} = await runTransfer({
      ...CLIENT,
      downloadResults: [endingAt('https://elsewhere.example.invalid/x')],
    });
    deepStrictEqual(removed, [LOCAL_FILE]);
  });
});

describe('a cache entry the host cannot unpack (F-6301.BR-4)', () => {
  const FOUND: Setup = {
    plan: {where: 'client'},
    cache: {kind: 'kept', archivePath: KEPT},
    existing: [KEPT],
    copies: [
      {matches: () => true, ending: {kind: 'copied'}},
      {matches: () => true, ending: {kind: 'copied'}},
    ],
  };
  const BAD_ENTRY = {
    ...FOUND,
    installs: [block('UnpackFailed'), INSTALLED],
  };

  it('V4: is deleted and downloaded once more in the same transfer', async () => {
    const {outcome} = await runTransfer(BAD_ENTRY);
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it('V4: the entry is deleted', async () => {
    const {removed} = await runTransfer(BAD_ENTRY);
    deepStrictEqual(removed, [KEPT, TEMPORARY]);
  });

  it('V4: the new download takes its place', async () => {
    const {renames} = await runTransfer(BAD_ENTRY);
    deepStrictEqual(renames, [`${TEMPORARY} -> ${KEPT}`]);
  });

  it('V4: it is downloaded once, not in a loop', async () => {
    const {downloads} = await runTransfer({
      ...FOUND,
      installs: [block('UnpackFailed'), block('UnpackFailed')],
    });
    deepStrictEqual(downloads.length, 1);
  });

  it('V4: a second failure to unpack is the outcome', async () => {
    const {outcome} = await runTransfer({
      ...FOUND,
      installs: [block('UnpackFailed'), block('UnpackFailed')],
    });
    deepStrictEqual(failureOf(outcome), {kind: 'unpack'});
  });

  it('V4: another failure with a found entry leaves the entry alone', async () => {
    const {removed} = await runTransfer({
      ...FOUND,
      installs: [block('CreateInstallDirFailed')],
    });
    deepStrictEqual(removed, []);
  });

  it('V4: a download of this run that the host cannot unpack is not downloaded again', async () => {
    const {downloads} = await runTransfer({
      plan: {where: 'client'},
      cache: {kind: 'kept', archivePath: KEPT},
      installs: [block('UnpackFailed')],
    });
    deepStrictEqual(downloads.length, 1);
  });
});

describe("the names of the transfer's files (F-6301.BR-14)", () => {
  const KEEP: Setup = {
    plan: {where: 'client'},
    cache: {kind: 'kept', archivePath: KEPT},
  };

  async function destinationFor(token: string): Promise<string[]> {
    const {downloads} = await runTransfer({...KEEP, token});
    return downloads.map(request => request.destination);
  }

  it('F-6301.BR-14: two windows that start in the same millisecond write different files', async () => {
    deepStrictEqual(
      [await destinationFor('a'), await destinationFor('b')],
      [[`${KEPT}_1700000000000-a`], [`${KEPT}_1700000000000-b`]],
    );
  });

  it('F-6301.BR-14: the copy on the host carries the token too', async () => {
    const {channel} = await runTransfer({...KEEP, token: 'b'});
    deepStrictEqual(copiesOf(channel), [
      `${KEPT} -> ${HOST_FOLDER}/server-abc123-1700000000000-b.tar.gz`,
    ]);
  });

  it('F-6301.BR-14: a download that is not kept carries the token in the client folder', async () => {
    const {downloads} = await runTransfer({
      plan: {where: 'client'},
      token: 'b',
    });
    deepStrictEqual(
      downloads.map(request => request.destination),
      [path.join(CLIENT_FOLDER, 'server-abc123-1700000000000-b.tar.gz')],
    );
  });
});
