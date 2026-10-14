import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  INSTALL_IF_LOCAL_KEY,
  mergeInstallIfLocal,
  moveInstallIfLocal,
  OLD_INSTALL_IF_LOCAL_KEY,
} from '../../src/extensions/install-if-local.ts';

/** The move over a user store holding these values; the writes it made, in order, and the log lines. */
async function moved(
  values: Record<string, unknown>,
  failing?: unknown,
): Promise<{writes: Array<[string, unknown]>; warnings: string[]}> {
  const writes: Array<[string, unknown]> = [];
  const sink = new MemorySink();
  await moveInstallIfLocal({
    userValue: key => values[key],
    writeUserValue: (key, value) => {
      writes.push([key, value]);
      return failing === undefined
        ? Promise.resolve()
        : // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- one row rejects with a text
          Promise.reject(failing);
    },
    logger: createLogger(sink, {minimumLevel: () => 'debug'}),
  });
  return {
    writes,
    warnings: sink.lines
      .filter(line => line.level === 'warn')
      .map(line => line.message),
  };
}

describe('the move of the install-if-installed-locally setting (card containers-16)', () => {
  it('F-0505 AC-19: the old key moves into the core key', async () => {
    deepStrictEqual((await moved({[OLD_INSTALL_IF_LOCAL_KEY]: ['A']})).writes, [
      [INSTALL_IF_LOCAL_KEY, ['A']],
      [OLD_INSTALL_IF_LOCAL_KEY, undefined],
    ]);
  });

  it('F-0505 AC-20: existing ids first, no duplicates', async () => {
    deepStrictEqual(
      (
        await moved({
          [OLD_INSTALL_IF_LOCAL_KEY]: ['A', 'B'],
          [INSTALL_IF_LOCAL_KEY]: ['P', 'A'],
        })
      ).writes[0],
      [INSTALL_IF_LOCAL_KEY, ['P', 'A', 'B']],
    );
  });

  it('F-0505 BR-12: an old [] with no core key writes []', async () => {
    deepStrictEqual((await moved({[OLD_INSTALL_IF_LOCAL_KEY]: []})).writes[0], [
      INSTALL_IF_LOCAL_KEY,
      [],
    ]);
  });

  it('F-0505 BR-12: no old key does nothing', async () => {
    deepStrictEqual((await moved({[INSTALL_IF_LOCAL_KEY]: ['P']})).writes, []);
  });

  it('contracts: a failed write is logged and the old key stays', async () => {
    const outcome = await moved(
      {[OLD_INSTALL_IF_LOCAL_KEY]: ['A']},
      new Error('read-only'),
    );
    deepStrictEqual(
      [outcome.writes.length, outcome.warnings],
      [
        1,
        [
          'the old install-if-installed-locally setting could not be moved: read-only',
        ],
      ],
    );
  });

  it('contracts: a failure that is not an error is logged by its text', async () => {
    deepStrictEqual(
      (await moved({[OLD_INSTALL_IF_LOCAL_KEY]: ['A']}, 'denied')).warnings,
      [
        'the old install-if-installed-locally setting could not be moved: denied',
      ],
    );
  });

  it('contracts: a read that throws is logged and nothing is written', async () => {
    const writes: string[] = [];
    const sink = new MemorySink();
    await moveInstallIfLocal({
      userValue: () => {
        throw new Error('no configuration');
      },
      writeUserValue: key => {
        writes.push(key);
        return Promise.resolve();
      },
      logger: createLogger(sink, {minimumLevel: () => 'debug'}),
    });
    deepStrictEqual(
      [writes, sink.lines.map(line => [line.level, line.message])],
      [
        [],
        [
          [
            'warn',
            'the old install-if-installed-locally setting could not be moved: no configuration',
          ],
        ],
      ],
    );
  });

  it('contracts: values that are not lists count as empty, and non-text entries are skipped', () => {
    deepStrictEqual(
      [
        mergeInstallIfLocal('x', ['A', 3]),
        mergeInstallIfLocal(['P', 4], undefined),
      ],
      [['A'], ['P']],
    );
  });
});
