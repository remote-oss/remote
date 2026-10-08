/** The marker line that opens a result block; it must be a whole line, exactly. */
export const RESULT_BEGIN = 'remote-oss-server-result-begin';

/** The marker line that closes a result block; it must be a whole line, exactly. */
export const RESULT_END = 'remote-oss-server-result-end';

/**
 * The status a bootstrap script may report. A word outside this list maps the block's status to
 * ServerFailedToStart and keeps the word in `unknownStatus`.
 */
export type ScriptStatus =
  | 'Ok'
  | 'LockBusy'
  | 'NoDownloaderAvailable'
  | 'UnpackFailed'
  | 'ServerDownloadFailed'
  | 'CreateInstallDirFailed'
  | 'UnsupportedArch'
  | 'UnsupportedPlatform'
  | 'LinuxPrereqs'
  | 'NoBash'
  | 'ServerFailedToStart';

/** The result block a bootstrap script prints: its status, the facts it learned, and its timings. */
export interface ResultBlock {
  status: ScriptStatus;
  /** The `host.*` keys of the block, without their prefix. */
  hostFacts: Record<string, string>;
  /** The `server.*` keys of the block, without their prefix. */
  serverFacts: Record<string, string>;
  /** The `timing.*` keys of the block, without their prefix, in integer milliseconds. */
  timings: Record<string, number>;
  /** Set when the printed status word was not a ScriptStatus; status is then ServerFailedToStart. */
  unknownStatus?: string;
}

const STATUS_WORDS: readonly ScriptStatus[] = [
  'Ok',
  'LockBusy',
  'NoDownloaderAvailable',
  'UnpackFailed',
  'ServerDownloadFailed',
  'CreateInstallDirFailed',
  'UnsupportedArch',
  'UnsupportedPlatform',
  'LinuxPrereqs',
  'NoBash',
  'ServerFailedToStart',
];

const STATUS_SET = new Set<string>(STATUS_WORDS);
const HOST_PREFIX = 'host.';
const SERVER_PREFIX = 'server.';
const TIMING_PREFIX = 'timing.';
const TIMING_VALUE = /^\d+$/;

/** One result block as it is read, before the status word is checked. */
interface RawBlock {
  statusWord: string | undefined;
  hostFacts: Record<string, string>;
  serverFacts: Record<string, string>;
  timings: Record<string, number>;
}

function emptyBlock(): RawBlock {
  return {
    statusWord: undefined,
    hostFacts: {},
    serverFacts: {},
    timings: {},
  };
}

/** Whether a printed status word is one of the ScriptStatus words. */
function isScriptStatus(word: string): word is ScriptStatus {
  return STATUS_SET.has(word);
}

/**
 * Record one line of a result block. A line without `=` is ignored; the key and the value are not
 * trimmed; a repeated key keeps the last value; a timing that is not a non-negative integer is
 * dropped.
 */
function recordLine(block: RawBlock, line: string): void {
  const separator = line.indexOf('=');
  if (separator === -1) {
    return;
  }
  const field = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (field === 'status') {
    block.statusWord = value;
  } else if (field.startsWith(HOST_PREFIX)) {
    block.hostFacts[field.slice(HOST_PREFIX.length)] = value;
  } else if (field.startsWith(SERVER_PREFIX)) {
    block.serverFacts[field.slice(SERVER_PREFIX.length)] = value;
  } else if (field.startsWith(TIMING_PREFIX)) {
    if (TIMING_VALUE.test(value)) {
      block.timings[field.slice(TIMING_PREFIX.length)] = Number(value);
    }
  }
}

/**
 * Find the last complete result block in a bootstrap script's output lines. A complete block is
 * the lines between the two marker lines; a block without `status=` or without its end marker
 * counts for nothing, and the lines outside complete blocks are ignored.
 */
export function parseResult(
  lines: readonly string[],
): {block: ResultBlock} | {failure: 'noResultBlock'} {
  let current: RawBlock | undefined;
  let latest: RawBlock | undefined;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line === RESULT_BEGIN) {
      current = emptyBlock();
      continue;
    }
    if (line === RESULT_END) {
      if (current !== undefined) {
        latest = current;
      }
      current = undefined;
      continue;
    }
    if (current !== undefined) {
      recordLine(current, line);
    }
  }
  if (latest?.statusWord === undefined) {
    return {failure: 'noResultBlock'};
  }
  const block: ResultBlock = {
    status: 'ServerFailedToStart',
    hostFacts: latest.hostFacts,
    serverFacts: latest.serverFacts,
    timings: latest.timings,
  };
  if (isScriptStatus(latest.statusWord)) {
    block.status = latest.statusWord;
  } else {
    block.unknownStatus = latest.statusWord;
  }
  return {block};
}
