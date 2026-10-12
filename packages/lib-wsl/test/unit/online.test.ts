import {deepStrictEqual} from 'node:assert';
import {parseOnline} from '../../src/index.ts';

const EXPLANATION =
  "The following is a list of valid distributions that can be installed.\nInstall using 'wsl.exe --install <Distro>'.";
const TABLE = [
  'NAME                  FRIENDLY NAME',
  'Ubuntu                Ubuntu',
  'Ubuntu-24.04          Ubuntu 24.04 LTS',
].join('\n');
const ROWS = {
  kind: 'rows',
  rows: [
    {name: 'Ubuntu', friendlyName: 'Ubuntu'},
    {name: 'Ubuntu-24.04', friendlyName: 'Ubuntu 24.04 LTS'},
  ],
};

describe('parseOnline', () => {
  it('F-6102.BR-1: reads the table after an explanation', () => {
    deepStrictEqual(parseOnline(`${EXPLANATION}\n\n${TABLE}\n`), ROWS);
  });

  it('F-6102.BR-3: keeps the internal name apart from the friendly name', () => {
    deepStrictEqual(
      parseOnline(
        'NAME                  FRIENDLY NAME\nOracleLinux_9_5        Oracle Linux 9.5',
      ),
      {
        kind: 'rows',
        rows: [{name: 'OracleLinux_9_5', friendlyName: 'Oracle Linux 9.5'}],
      },
    );
  });

  it('D1a: reads the same text with CRLF line ends', () => {
    deepStrictEqual(
      parseOnline(`${EXPLANATION}\n\n${TABLE}`.replaceAll('\n', '\r\n')),
      ROWS,
    );
  });

  it('D1a: reads a table with no explanation', () => {
    deepStrictEqual(parseOnline(TABLE), ROWS);
  });

  it('D1a: a header with no rows gives no rows', () => {
    deepStrictEqual(
      parseOnline(`${EXPLANATION}\n\nNAME                  FRIENDLY NAME`),
      {kind: 'rows', rows: []},
    );
  });

  it('D1a: empty text gives no rows', () => {
    deepStrictEqual(parseOnline(''), {kind: 'rows', rows: []});
  });

  it('brief: the last of three blocks is the table', () => {
    deepStrictEqual(
      parseOnline(`first block\n\n${EXPLANATION}\n\n${TABLE}`),
      ROWS,
    );
  });

  it('brief: a localised header and non-ASCII text are read', () => {
    deepStrictEqual(
      parseOnline('NOM   NOM CONVIVIAL\nUbuntu   Ubuntu für Test'),
      {kind: 'rows', rows: [{name: 'Ubuntu', friendlyName: 'Ubuntu für Test'}]},
    );
  });

  it('D1a: a header with no run of two spaces is unparseable', () => {
    deepStrictEqual(parseOnline('NAME FRIENDLY NAME\nUbuntu Ubuntu'), {
      kind: 'unparseable',
      reason: 'header',
    });
  });

  it('D1a: a header whose spaces end the line is unparseable', () => {
    deepStrictEqual(parseOnline('NAME   \nUbuntu'), {
      kind: 'unparseable',
      reason: 'header',
    });
  });

  it('D1a: a row shorter than the column is unparseable at its number', () => {
    deepStrictEqual(
      parseOnline('NAME                  FRIENDLY NAME\nUbuntu'),
      {
        kind: 'unparseable',
        reason: 'line:1',
      },
    );
  });

  it('D1a: the number of a bad row counts the table rows', () => {
    deepStrictEqual(
      parseOnline('NAME    FRIENDLY NAME\nUbuntu  Ubuntu\n        Nameless'),
      {kind: 'unparseable', reason: 'line:2'},
    );
  });
});
