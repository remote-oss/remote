import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {validDistroName} from '../../src/index.ts';

const CASES = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', 'distro-names.json'),
    'utf8',
  ),
) as Array<{name: string; valid: boolean}>;

describe('the check of a distro name', () => {
  for (const {name, valid} of CASES) {
    it(`F-6203 (ruling-2348-distro-name): ${JSON.stringify(name)} is ${valid ? 'valid' : 'not valid'}`, () => {
      deepStrictEqual(validDistroName(name), valid);
    });
  }
});
