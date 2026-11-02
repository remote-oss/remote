import {deepStrictEqual} from 'node:assert';
import type {PhaseName} from 'lib-authority';
import {
  detailsTitleOf,
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

  it('F-2108 AC-3, AC-31: the running script stage has S118 with the show log link, whose command is the log command', () => {
    deepStrictEqual(phaseTitleOf({name: 'runningPreconnectScript'}), {
      id: 'S118',
      values: ['[show log](command:opensshremotes.showLog "Show log")'],
    });
  });

  it('F-2304: the stage of starting the server has no message, which the ssh connector never reports', () => {
    deepStrictEqual(phaseTitleOf({name: 'startingServer'}), undefined);
  });

  it('F-2304: the share downloaded has no message, so the last one stays', () => {
    deepStrictEqual(
      phaseTitleOf({name: 'serverDownloadPercent', percent: 40}),
      undefined,
    );
  });

  it('connect-113, F-2308 AC-7: the tunnel stage in the terminal mode has the title S132', () => {
    deepStrictEqual(detailsTitleOf('settingUpTunnel', true), {
      id: 'S132',
      values: [],
    });
  });

  it('connect-113: the tunnel stage has no title outside the terminal mode', () => {
    deepStrictEqual(detailsTitleOf('settingUpTunnel', false), undefined);
  });

  it('connect-113: another stage has no title in the terminal mode either', () => {
    deepStrictEqual(detailsTitleOf('initializing', true), undefined);
  });
});
