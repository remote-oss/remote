import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {
  ATTEMPT_FILE_LIMIT,
  ATTEMPT_LINE_LIMIT,
  createAttemptLog,
  writeAttemptLog,
} from '../../src/connect/attempt-log.ts';

const STARTED = Date.UTC(2026, 10, 1, 12, 0, 0);

/** A logger over a new attempt log, with the clock fixed at {@link STARTED}. */
function loggedOver(secrets: readonly string[] = []) {
  const attempt = createAttemptLog();
  const logger = createLogger(attempt, {
    minimumLevel: () => 'info',
    clock: () => STARTED,
    secrets: () => secrets,
  });
  return {attempt, logger};
}

/** Runs `body` over a folder of its own and removes it after. */
async function inFolder(body: (folder: string) => Promise<void>) {
  const folder = mkdtempSync(path.join(tmpdir(), 'attempt-log-'));
  try {
    await body(folder);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

describe('the log of a connect attempt (card containers-111)', () => {
  it('F-0410 5.0: the lines are the log’s own, formatted as the channel shows them, and begin starts a new attempt', () => {
    const {attempt, logger} = loggedOver();
    logger.info('before');
    attempt.begin();
    logger.info('Resolving Remote');
    logger.warn('container is starting');
    deepStrictEqual(attempt.lines(), [
      '2026-11-01T12:00:00.000Z [info] Resolving Remote',
      '2026-11-01T12:00:00.000Z [warn] container is starting',
    ]);
  });

  it('F-0410 5.0, condition 1: a named secret is masked in the buffer and in the written file, and its raw value is in neither', async () => {
    const {attempt, logger} = loggedOver(['s3cr3t-token']);
    attempt.begin();
    logger.info('token=s3cr3t-token');
    await inFolder(async folder => {
      const file = await writeAttemptLog(attempt, folder, STARTED);
      deepStrictEqual(
        [
          attempt.lines().join('\n').includes('s3cr3t-token'),
          readFileSync(file, 'utf8').includes('s3cr3t-token'),
          readFileSync(file, 'utf8'),
        ],
        [false, false, '2026-11-01T12:00:00.000Z [info] token=[redacted]\n'],
      );
    });
  });

  it('F-0410 5.0: only the newest 5000 lines of an attempt are kept', () => {
    const {attempt, logger} = loggedOver();
    attempt.begin();
    for (let line = 0; line < ATTEMPT_LINE_LIMIT + 3; line += 1) {
      logger.info(`line ${String(line)}`);
    }
    deepStrictEqual(
      [attempt.lines().length, attempt.lines()[0], attempt.lines().at(-1)],
      [
        ATTEMPT_LINE_LIMIT,
        '2026-11-01T12:00:00.000Z [info] line 3',
        `2026-11-01T12:00:00.000Z [info] line ${String(ATTEMPT_LINE_LIMIT + 2)}`,
      ],
    );
  });

  it('F-0410 5.0: the file is named dev-containers-attempt- and the time, in the folder that is made when it is missing', async () => {
    const {attempt} = loggedOver();
    await inFolder(async folder => {
      const inner = path.join(folder, 'logs');
      deepStrictEqual(
        path.basename(await writeAttemptLog(attempt, inner, STARTED)),
        'dev-containers-attempt-20261101T120000.log',
      );
    });
  });

  it('F-0410 5.0, condition 2: after an eleventh write the folder holds ten attempt files and the oldest is gone', async () => {
    const {attempt} = loggedOver();
    await inFolder(async folder => {
      for (let write = 0; write <= ATTEMPT_FILE_LIMIT; write += 1) {
        await writeAttemptLog(attempt, folder, STARTED + write * 1000);
      }
      const names = readdirSync(folder).sort();
      deepStrictEqual(
        [names.length, names[0]],
        [ATTEMPT_FILE_LIMIT, 'dev-containers-attempt-20261101T120001.log'],
      );
    });
  });

  it('F-0410 5.0: files that are not attempt files are not counted and not deleted', async () => {
    const {attempt} = loggedOver();
    await inFolder(async folder => {
      await writeAttemptLog(attempt, folder, STARTED);
      const other = path.join(folder, 'remoteagent.log');
      await writeFile(other, 'x');
      for (let write = 1; write <= ATTEMPT_FILE_LIMIT; write += 1) {
        await writeAttemptLog(attempt, folder, STARTED + write * 1000);
      }
      deepStrictEqual(
        [
          readdirSync(folder).includes('remoteagent.log'),
          readdirSync(folder).length,
        ],
        [true, ATTEMPT_FILE_LIMIT + 1],
      );
    });
  });
});
