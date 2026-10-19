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

  it('F-0503 AC-2: installing and starting the server give only their own text, which core shows after the title and a colon', () => {
    deepStrictEqual(
      [
        phaseTitleOf({name: 'installing'}, template => template),
        phaseTitleOf({name: 'startingServer'}, template => template),
      ],
      ['Installing server', 'Starting server'],
    );
  });

  it('F-0408 BR-2: every other stage gives an empty message, never the start title again', () => {
    deepStrictEqual(
      OTHER_PHASES.map(name => phaseTitleOf({name}, template => template)),
      OTHER_PHASES.map(() => ''),
    );
  });

  it('F-0503 AC-2: the stage text is translated on its own', () => {
    deepStrictEqual(
      phaseTitleOf({name: 'installing'}, template => `<${template}>`),
      '<Installing server>',
    );
  });
});
