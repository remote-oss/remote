/**
 * @fileoverview The parse of the WSL distribution list (card wsl-02): the rows and their parts, the header
 * never inspected, the state words, the version column, and the lines that do not parse.
 */

import {deepStrictEqual} from 'node:assert';
import {parseList, type DistroRow} from '../../src/index.ts';

/** The lines of a list text, joined with line feeds. */
function list(...lines: string[]): string {
  return lines.join('\n');
}

/** The rows of the marked-and-plain list: Ubuntu as the default, Debian plain, both version 2. */
const ubuntuDebian: readonly DistroRow[] = [
  {name: 'Ubuntu', isDefault: true, state: 'running', version: 2},
  {name: 'Debian', isDefault: false, state: 'stopped', version: 2},
];

describe('parseList (card wsl-02)', () => {
  it('contracts.md §1 D1a: a header with no rows is an empty list', () => {
    deepStrictEqual(parseList(list('  NAME      STATE           VERSION')), {
      kind: 'rows',
      rows: [],
    });
  });

  it('contracts.md §1 D1a: empty text is an empty list', () => {
    deepStrictEqual(parseList(''), {kind: 'rows', rows: []});
  });

  it('contracts.md §1 D1a: a marked row is the default, the plain row is not', () => {
    deepStrictEqual(
      parseList(
        list(
          '  NAME      STATE           VERSION',
          '* Ubuntu    Running         2',
          '  Debian    Stopped         2',
        ),
      ),
      {kind: 'rows', rows: ubuntuDebian},
    );
  });

  it('contracts.md §1 D1a: the state words name their states', () => {
    deepStrictEqual(
      parseList(
        list(
          '  NAME      STATE',
          '  One   Installing  2',
          '  Two   Converting  2',
          '  Three   Stopped  2',
        ),
      ),
      {
        kind: 'rows',
        rows: [
          {name: 'One', isDefault: false, state: 'installing', version: 2},
          {name: 'Two', isDefault: false, state: 'converting', version: 2},
          {name: 'Three', isDefault: false, state: 'stopped', version: 2},
        ],
      },
    );
  });

  it('contracts.md §1 D1a: the state word Suspended is other', () => {
    deepStrictEqual(
      parseList(list('  NAME      STATE', '  Alpine   Suspended')),
      {
        kind: 'rows',
        rows: [
          {
            name: 'Alpine',
            isDefault: false,
            state: 'other',
            version: 'unknown',
          },
        ],
      },
    );
  });

  it('contracts.md §1 D1a: the state word RUNNING is running', () => {
    deepStrictEqual(
      parseList(list('  NAME      STATE', '  Alpine   RUNNING')),
      {
        kind: 'rows',
        rows: [
          {
            name: 'Alpine',
            isDefault: false,
            state: 'running',
            version: 'unknown',
          },
        ],
      },
    );
  });

  it('contracts.md §1 D1a: the localised state word Läuft is other', () => {
    deepStrictEqual(parseList(list('  NAME      STATE', '  Alpine   Läuft')), {
      kind: 'rows',
      rows: [
        {name: 'Alpine', isDefault: false, state: 'other', version: 'unknown'},
      ],
    });
  });

  it('contracts.md §1 D1a: the version column 1 is version 1', () => {
    deepStrictEqual(
      parseList(list('  NAME      STATE  VERSION', '  Alpine   Running 1')),
      {
        kind: 'rows',
        rows: [
          {name: 'Alpine', isDefault: false, state: 'running', version: 1},
        ],
      },
    );
  });

  it('contracts.md §1 D1a: the version column 3 is unknown', () => {
    deepStrictEqual(
      parseList(list('  NAME      STATE  VERSION', '  Alpine   Running 3')),
      {
        kind: 'rows',
        rows: [
          {
            name: 'Alpine',
            isDefault: false,
            state: 'running',
            version: 'unknown',
          },
        ],
      },
    );
  });

  it('contracts.md §1 D1a: a missing version column is unknown', () => {
    deepStrictEqual(
      parseList(list('  NAME      STATE', '  Alpine   Stopped')),
      {
        kind: 'rows',
        rows: [
          {
            name: 'Alpine',
            isDefault: false,
            state: 'stopped',
            version: 'unknown',
          },
        ],
      },
    );
  });

  it('contracts.md §1 D1a: names are kept exactly, inner space and all', () => {
    deepStrictEqual(
      parseList(
        list(
          '  NAME      STATE  VERSION',
          '  fixture γ   Running 2',
          '  Fixture.Beta-2   Running 2',
        ),
      ),
      {
        kind: 'rows',
        rows: [
          {name: 'fixture γ', isDefault: false, state: 'running', version: 2},
          {
            name: 'Fixture.Beta-2',
            isDefault: false,
            state: 'running',
            version: 2,
          },
        ],
      },
    );
  });

  it('contracts.md §1 D1a: a localised header does not change the rows', () => {
    deepStrictEqual(
      parseList(
        list('  NOM   ÉTAT   VERSION', '  Ubuntu    Running         2'),
      ),
      {
        kind: 'rows',
        rows: [
          {name: 'Ubuntu', isDefault: false, state: 'running', version: 2},
        ],
      },
    );
  });

  it('contracts.md §1 D1a: line ends with line feeds and carriage returns parse the same', () => {
    deepStrictEqual(
      parseList(
        list(
          '  NAME      STATE           VERSION\r',
          '* Ubuntu    Running         2\r',
          '  Debian    Stopped         2\r',
        ),
      ),
      {kind: 'rows', rows: ubuntuDebian},
    );
  });

  it('contracts.md §1 D1a: the blank lines around the rows are not rows', () => {
    deepStrictEqual(
      parseList(
        list(
          '  NAME      STATE           VERSION',
          '',
          '  Ubuntu    Running         2',
          '',
        ),
      ),
      {
        kind: 'rows',
        rows: [
          {name: 'Ubuntu', isDefault: false, state: 'running', version: 2},
        ],
      },
    );
  });

  it('contracts.md §1 D1a: a marker without a space after it still marks the default', () => {
    deepStrictEqual(
      parseList(list('  NAME      STATE  VERSION', '*Ubuntu Running 2')),
      {
        kind: 'rows',
        rows: [{name: 'Ubuntu', isDefault: true, state: 'running', version: 2}],
      },
    );
  });

  it('contracts.md §1 D1a: a line that does not fit the layout is unparseable', () => {
    deepStrictEqual(parseList(list('  NAME      STATE  VERSION', 'broken')), {
      kind: 'unparseable',
      reason: 'line:1',
    });
  });

  it('contracts.md §1 D1a: a later bad line is unparseable, and no row is kept', () => {
    deepStrictEqual(
      parseList(
        list('  NAME      STATE  VERSION', '  Ubuntu    Running 2', 'broken'),
      ),
      {kind: 'unparseable', reason: 'line:2'},
    );
  });
});
