import {deepStrictEqual} from 'node:assert';
import {
  CONNECTED_MARKER,
  markedRowIds,
} from '../../src/model/connected-marker.ts';
import {type HostRow, hostRowId} from '../../src/model/ssh-group.ts';

function rowFor(alias: string): HostRow {
  return {rowId: hostRowId(alias), alias, folders: []};
}

const ROWS = ['build-box', 'F5103-Upper', 'plain'].map(rowFor);

describe('the connected marker of a host row', () => {
  it('F-2503.AC-30: F-5103.BR-6: the row of the connected alias is marked', () => {
    deepStrictEqual(
      markedRowIds(ROWS, {connected: true, hostKey: 'build-box'}),
      ['ssh-host:build-box'],
    );
  });

  for (const alias of ['F5103-Upper', 'plain']) {
    it(`F-2503.AC-12: F-5103.BR-6: only the row ${alias} is marked`, () => {
      deepStrictEqual(markedRowIds(ROWS, {connected: true, hostKey: alias}), [
        `ssh-host:${alias}`,
      ]);
    });
  }

  it('F-5103.AC-15, AC-31: F-5103.BR-6: the case of the alias is compared exactly', () => {
    deepStrictEqual(
      markedRowIds(ROWS, {connected: true, hostKey: 'f5103-upper'}),
      [],
    );
  });

  it('F-5103.BR-6: a connected window whose alias names no row marks nothing', () => {
    deepStrictEqual(
      markedRowIds(ROWS, {connected: true, hostKey: '127.0.0.1'}),
      [],
    );
  });

  it('F-3906.RR-2: the encoded form of a typed host matches no row', () => {
    deepStrictEqual(
      markedRowIds(ROWS, {
        connected: true,
        hostKey: '7b22686f73744e616d65223a22616c706861227d',
      }),
      [],
    );
  });

  it('F-2503.AC-13, F-5103.AC-36: F-5103.BR-6: a local window marks nothing', () => {
    deepStrictEqual(markedRowIds(ROWS, {connected: false}), []);
  });

  it('F-5103.BR-6: a window whose connection has not succeeded marks nothing', () => {
    deepStrictEqual(
      markedRowIds(ROWS, {connected: false, hostKey: 'build-box'}),
      [],
    );
  });

  it('F-5902.5.precedence: a failed or foreign pull marks nothing', () => {
    deepStrictEqual(markedRowIds(ROWS, undefined), []);
  });

  it('F-5902.5.precedence: the push is not an input', () => {
    deepStrictEqual(markedRowIds.length, 2);
  });

  it('F-5103.BR-6: a connected pull with no host key marks nothing', () => {
    deepStrictEqual(markedRowIds(ROWS, {connected: true}), []);
  });

  it('F-5103.BR-6: no rows mark nothing', () => {
    deepStrictEqual(
      markedRowIds([], {connected: true, hostKey: 'build-box'}),
      [],
    );
  });

  it('F-5103.BR-6: an alias listed twice marks one row', () => {
    deepStrictEqual(
      markedRowIds([rowFor('build-box'), rowFor('build-box')], {
        connected: true,
        hostKey: 'build-box',
      }),
      ['ssh-host:build-box'],
    );
  });

  it('F-5103.BR-6: the same call twice gives equal results', () => {
    const pull = {connected: true, hostKey: 'plain'};
    deepStrictEqual(markedRowIds(ROWS, pull), markedRowIds(ROWS, pull));
  });

  it('F-5103.BR-6: the marker is the description id and the icon', () => {
    deepStrictEqual(CONNECTED_MARKER, {
      descriptionId: 'S003',
      icon: 'vm-active',
    });
  });
});
