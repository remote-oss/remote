import {deepStrictEqual} from 'node:assert';
import type {PhaseName} from 'lib-authority';
import {phaseTitleOf, startTitleOf} from '../../src/connect/progress-titles.ts';

const START =
  '[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)';

const OTHER_PHASES: readonly PhaseName[] = [
  'initializing',
  'waitingForOtherWindow',
  'downloading',
  'downloadingLocally',
  'copyingWithScp',
  'settingUpTunnel',
  'waitingForForwarding',
  'serverDownloadPercent',
];

describe('the titles of the connect progress (card containers-08)', () => {
  it('F-0408 3.4 S087: the start title is the link to the log', () => {
    deepStrictEqual(
      startTitleOf(template => template),
      START,
    );
  });

  it('F-0503 AC-2: installing and starting the server follow the link after a colon', () => {
    deepStrictEqual(
      [
        phaseTitleOf({name: 'installing'}, template => template),
        phaseTitleOf({name: 'startingServer'}, template => template),
      ],
      [`${START}: Installing server`, `${START}: Starting server`],
    );
  });

  it('F-0408 BR-2: every other stage keeps the start title', () => {
    deepStrictEqual(
      OTHER_PHASES.map(name => phaseTitleOf({name}, template => template)),
      OTHER_PHASES.map(() => START),
    );
  });

  it('F-0503 AC-2: each part is translated on its own', () => {
    deepStrictEqual(
      phaseTitleOf({name: 'installing'}, template => `<${template}>`),
      '<[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)>: <Installing server>',
    );
  });
});
