import {deepStrictEqual} from 'node:assert';
import type {PhaseName} from 'lib-authority';
import {
  phaseTitleOf,
  startTitleOf,
} from '../../src/surfaces/progress-titles.ts';

const PHASE_IDS: ReadonlyArray<readonly [PhaseName, string]> = [
  ['initializing', 'S082'],
  ['downloading', 'S041'],
  ['downloadingLocally', 'S044'],
  ['copyingWithScp', 'S029'],
  ['installing', 'S084'],
  ['settingUpTunnel', 'S130'],
  ['waitingForForwarding', 'S158'],
  ['waitingForOtherWindow', 'S157'],
];

describe('the titles of the connection progress', () => {
  it('F-2304 S129: the start title names the host', () => {
    deepStrictEqual(startTitleOf('box'), {id: 'S129', values: ['box']});
  });

  for (const [name, stringId] of PHASE_IDS) {
    it(`F-2304: ${name} has the message ${stringId}`, () => {
      deepStrictEqual(phaseTitleOf({name}), {id: stringId, values: []});
    });
  }

  it('F-2304: the share downloaded has no message, so the last one stays', () => {
    deepStrictEqual(
      phaseTitleOf({name: 'serverDownloadPercent', percent: 40}),
      undefined,
    );
  });
});
