import {deepStrictEqual} from 'node:assert';
import {
  hintTable,
  type HintTableRow,
  messageCellOf,
  wrappedText,
} from '../../src/diagnostics/hint-table.ts';

const OFFLINE: HintTableRow = {
  status: 'OfflineError',
  message: 'Error: OfflineError (The connection timed out)',
  mitigations: [],
  resources: [],
};

const FORWARDING: HintTableRow = {
  status: 'AllowTcpForwardingDisabled',
  message: 'The remote server has TCP forwarding disabled',
  mitigations: ['Add AllowTcpForwarding yes', 'Restart the SSH server'],
  resources: ['https://docs.example/remote'],
};

describe('the table of the session troubleshooting terminal (card connect-136, F-2605 section 11)', () => {
  it('F-2605.AC-4: two columns for an error with neither mitigations nor resources: a double outer border, a single rule under the header, Status centred and the table as wide as the terminal', () => {
    deepStrictEqual(hintTable([OFFLINE], 70), [
      '╔══════════════╤═════════════════════════════════════════════════════╗',
      '║    Status    │ Message                                             ║',
      '╟──────────────┼─────────────────────────────────────────────────────╢',
      '║ OfflineError │ Error: OfflineError (The connection timed out)      ║',
      '╚══════════════╧═════════════════════════════════════════════════════╝',
    ]);
  });

  it('F-2605.AC-4: the table fills the width of the terminal exactly, whatever the width', () => {
    deepStrictEqual(
      [60, 80, 120].map(width => hintTable([OFFLINE], width)[0]?.length),
      [60, 80, 120],
    );
  });

  it('F-2605.AC-5: four columns when an error has mitigations or resources, the three after Status sharing the rest equally, each item on its own bullet and wrapping under itself', () => {
    deepStrictEqual(hintTable([FORWARDING], 120), [
      '╔════════════════════════════╤═════════════════════════════╤═════════════════════════════╤═════════════════════════════╗',
      '║           Status           │ Message                     │ Mitigations                 │ Resources                   ║',
      '╟────────────────────────────┼─────────────────────────────┼─────────────────────────────┼─────────────────────────────╢',
      '║ AllowTcpForwardingDisabled │ The remote server has TCP   │ • Add AllowTcpForwarding    │ •                           ║',
      '║                            │ forwarding disabled         │   yes                       │ https://docs.example/remote ║',
      '║                            │                             │ • Restart the SSH server    │                             ║',
      '╚════════════════════════════╧═════════════════════════════╧═════════════════════════════╧═════════════════════════════╝',
    ]);
  });

  it('F-2605.AC-5: the three flexible columns are equally wide', () => {
    const header = hintTable([FORWARDING], 132)[1] ?? '';
    deepStrictEqual(
      header
        .slice(1, -1)
        .split(/[│]/u)
        .slice(1)
        .map(cell => cell.length),
      Array.from({length: 3}, () => header.split('│')[1]?.length),
    );
  });

  it('F-2605 section 11: a URL that does not fit after the bullet leaves the bullet alone and starts on the next line, breaking after / . _ or - where it can', () => {
    const url =
      'https://docs.example/remote/troubleshooting#hanging-or-failing-connections';
    deepStrictEqual(
      hintTable([{...FORWARDING, resources: [url]}], 100)
        .map(line => line.split('│').at(-1)?.replace('║', '').trim() ?? '')
        .slice(3, 9),
      [
        '•',
        'https://docs.',
        'example/remote/',
        'troubleshooting#hang',
        'ing-or-failing-',
        'connections',
      ],
    );
  });

  it('F-2605 BR-6: one row for each hint, in the order given, with a single rule between rows', () => {
    const lines = hintTable(
      [OFFLINE, {...OFFLINE, status: 'PermissionDenied'}],
      80,
    );
    deepStrictEqual(
      lines.map(line => line.slice(0, 1)),
      ['╔', '║', '╟', '║', '╟', '║', '╚'],
    );
  });

  it('F-2605 section 11: the Status column is as wide as the longest code, and a longer code widens it', () => {
    deepStrictEqual(
      [
        hintTable([OFFLINE], 80)[1],
        hintTable([{...OFFLINE, status: 'PermissionDenied'}], 80)[1],
      ].map(line => line?.indexOf('│')),
      [15, 19],
    );
  });

  it('F-2605 section 11: the table is drawn again for another width, the same rules applying, and a four-column table ends a few cells short of the edge', () => {
    deepStrictEqual(
      [
        hintTable([FORWARDING], 132).length <
          hintTable([FORWARDING], 80).length,
        hintTable([FORWARDING], 80)[0]?.length,
      ],
      [true, 78],
    );
  });

  it('F-2605.AC-24: the cells hold plain text, with no escape sequence', () => {
    deepStrictEqual(
      hintTable([OFFLINE, FORWARDING], 120).some(line =>
        line.includes('\u001b'),
      ),
      false,
    );
  });

  it('wraps at spaces, keeps a short word whole and breaks a long one after a separator', () => {
    deepStrictEqual(
      [
        wrappedText('one two three', 7),
        wrappedText('a/very/long/path.ext', 8),
        wrappedText('abcdefghij', 4),
        wrappedText('', 5),
      ],
      [
        ['one two', 'three'],
        ['a/very/', 'long/', 'path.ext'],
        ['abcd', 'efgh', 'ij'],
        [''],
      ],
    );
  });

  it('F-2605 BR-5: the message cell holds the details in brackets when there are any', () => {
    deepStrictEqual(
      [
        messageCellOf('Error: OfflineError', 'The connection timed out'),
        messageCellOf('Prose', undefined),
        messageCellOf('Prose', ''),
      ],
      ['Error: OfflineError (The connection timed out)', 'Prose', 'Prose'],
    );
  });
});
