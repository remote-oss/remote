import {deepStrictEqual, throws} from 'node:assert';
import {appendFileSync, readFileSync} from 'node:fs';
import {scriptFor} from './script.ts';

describe('the script of the scripted adapters', () => {
  it('tooling-13: the script file holds the entries the test gave', () => {
    scriptFor([{surface: 'pick', match: 'authenticity', answer: 'no'}]);
    deepStrictEqual(
      JSON.parse(
        readFileSync(process.env.REMOTE_OSS_ACCEPTANCE_SCRIPT ?? '', 'utf8'),
      ),
      {entries: [{surface: 'pick', match: 'authenticity', answer: 'no'}]},
    );
  });

  it('tooling-13: a fresh script starts with an empty record', () => {
    deepStrictEqual(scriptFor([]).record(), []);
  });

  /** Appends one line of the record, as the extension's adapters do. */
  function recorded(matched: boolean): void {
    appendFileSync(
      process.env.REMOTE_OSS_ACCEPTANCE_RECORD ?? '',
      `${JSON.stringify({surface: 'pick', question: 'q', answer: 'yes', matched})}\n`,
    );
  }

  it('ruling 5: a script entry no question used fails the test', () => {
    const script = scriptFor([
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
    ]);
    throws(() => {
      script.assertAllUsed();
    }, /1 of 1 script entries were not used/);
  });

  it('ruling 5: a question no entry matched does not count as a used entry', () => {
    const script = scriptFor([
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
    ]);
    recorded(false);
    throws(() => {
      script.assertAllUsed();
    }, /1 of 1 script entries were not used/);
  });

  it('ruling 5: a script whose entries were all used passes', () => {
    const script = scriptFor([
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
    ]);
    recorded(true);
    script.assertAllUsed();
  });
});
