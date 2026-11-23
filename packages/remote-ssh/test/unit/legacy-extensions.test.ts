import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {
  CORE_EXTENSIONS_KEY,
  LEGACY_EXTENSIONS_KEY,
  migrateLegacyExtensions,
} from '../../src/settings/legacy-extensions.ts';

describe('the move of the legacy extensions key', () => {
  function ports(values: Record<string, unknown>, failing?: string) {
    const written: Array<[string, unknown]> = [];
    const lines: string[] = [];
    return {
      written,
      lines,
      ports: {
        read: (key: string) => values[key],
        write: (key: string, value: unknown) => {
          if (key === failing) {
            return Promise.reject(new Error('read-only settings'));
          }
          written.push([key, value]);
          return Promise.resolve();
        },
        logger: createLogger(
          {
            write: record => {
              lines.push(`${record.level}: ${record.message}`);
            },
          },
          {minimumLevel: (): Level => 'info'},
        ),
      },
    };
  }

  it('F-2506 AC-9: writes the editor key first, then removes the legacy key, with one info line', async () => {
    const made = ports({
      [LEGACY_EXTENSIONS_KEY]: ['c.d'],
      [CORE_EXTENSIONS_KEY]: ['a.b'],
    });
    await migrateLegacyExtensions(made.ports);
    deepStrictEqual(
      [made.written, made.lines],
      [
        [
          [CORE_EXTENSIONS_KEY, ['a.b', 'c.d']],
          [LEGACY_EXTENSIONS_KEY, undefined],
        ],
        [
          "info: moved the legacy remote.SSH extensions key into the editor's remote extensions key (1 items)",
        ],
      ],
    );
  });

  it('F-2506 AC-23: without a user legacy key nothing is written, and one line says none was found', async () => {
    const made = ports({[CORE_EXTENSIONS_KEY]: ['a.b']});
    await migrateLegacyExtensions(made.ports);
    deepStrictEqual(
      [made.written, made.lines],
      [[], ['info: no legacy remote.SSH extensions key found']],
    );
  });

  it("F-2506 AC-21: the legacy items are appended to the editor key without a spelling that is there, in the editor key's spelling", async () => {
    const made = ports({
      [LEGACY_EXTENSIONS_KEY]: ['A.B', 'c.d'],
      [CORE_EXTENSIONS_KEY]: ['a.b'],
    });
    await migrateLegacyExtensions(made.ports);
    deepStrictEqual(made.written[0], [CORE_EXTENSIONS_KEY, ['a.b', 'c.d']]);
  });

  it('F-2506 6.3: a legacy value that is no list is removed and the editor key is not written', async () => {
    const made = ports({[LEGACY_EXTENSIONS_KEY]: 'a.b'});
    await migrateLegacyExtensions(made.ports);
    deepStrictEqual(made.written, [[LEGACY_EXTENSIONS_KEY, undefined]]);
  });

  it('F-2506 AC-22: an empty legacy list with no editor key writes an empty list', async () => {
    const made = ports({[LEGACY_EXTENSIONS_KEY]: []});
    await migrateLegacyExtensions(made.ports);
    deepStrictEqual(made.written, [
      [CORE_EXTENSIONS_KEY, []],
      [LEGACY_EXTENSIONS_KEY, undefined],
    ]);
  });

  it('F-2506 6.3: a failing write is logged, leaves the legacy key and does not fail the caller', async () => {
    const made = ports({[LEGACY_EXTENSIONS_KEY]: ['a.b']}, CORE_EXTENSIONS_KEY);
    await migrateLegacyExtensions(made.ports);
    deepStrictEqual(
      [made.written, made.lines],
      [
        [],
        [
          'warn: the legacy remote.SSH extensions key could not be moved: read-only settings',
        ],
      ],
    );
  });

  it('F-2506 6.3: a failure that is no Error is logged by its text', async () => {
    const made = ports({[LEGACY_EXTENSIONS_KEY]: ['a.b']});
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a port that breaks its contract, on purpose
    made.ports.write = () => Promise.reject('plain text');
    await migrateLegacyExtensions(made.ports);
    deepStrictEqual(made.lines, [
      'warn: the legacy remote.SSH extensions key could not be moved: plain text',
    ]);
  });
});
