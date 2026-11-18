/**
 * @fileoverview A throwaway measurement of card #2719: the AC-23 row (`failures.test.ts`) repeated alone, one window
 * and one script for each round, printing for each round whether the second failure dialog came and how soon.
 */

import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  appendScript,
  connectionLog,
  openWindow,
  recordLines,
  waitFor,
} from '../windows/harness.ts';
import {explainedFailure, section} from '../windows/connect-failure.ts';
import {
  answerEntry,
  dismissals,
  logSince,
  markerOf,
  withSetting,
  writeScript,
} from './support.ts';

/** The number of rounds. */
const ROUNDS = 25;

describe('card #2719: the second failure dialog of Retry, repeated', function () {
  this.timeout(300_000);

  afterEach(closeAllButLocal);

  for (let round = 1; round <= ROUNDS; round += 1) {
    it(`round ${String(round)}`, async () => {
      const name = `pf23-r${String(round)}`;
      const script = writeScript(
        `retry-always-${String(round)}.sh`,
        'echo ran >> "$MARKER"\nexit 1',
      );
      appendScript([
        answerEntry(name, "Allow and Don't Ask Again"),
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: {button: 'Retry'},
          window: name,
        },
        ...dismissals(name),
      ]);
      const mark = connectionLog().length;
      const began = Date.now();
      let outcome = 'came';
      try {
        await withSetting(script, async () => {
          await openWindow('harness', name);
          await waitFor(
            `the second failure dialog of ${name}`,
            () => recordLines('failureDialog', name).length >= 2,
            180_000,
          ).catch(async (caught: unknown) => {
            outcome = 'MISSED';
            throw await explainedFailure(caught, () =>
              Promise.resolve(
                [
                  section(`the record of ${name}`, () =>
                    recordLines(undefined, name)
                      .map(line => JSON.stringify(line))
                      .join('\n'),
                  ),
                  section("the script's marker", () =>
                    String(markerOf(script)),
                  ),
                  section('the connection log since the round began', () =>
                    logSince(mark).slice(-60).join('\n'),
                  ),
                ].join('\n'),
              ),
            );
          });
        });
      } finally {
        console.log(
          `ZZ2719 ${JSON.stringify({round, outcome, seconds: Math.round((Date.now() - began) / 100) / 10, dialogs: recordLines('failureDialog', name).length, marker: markerOf(script)})}`,
        );
      }
    });
  }
});
