import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
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
});
