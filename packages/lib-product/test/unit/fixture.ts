import {readFileSync} from 'node:fs';
import path from 'node:path';
import {type ProductProfile, readProfile} from '../../src/index.ts';

/** The profile of a fixture under test/fixtures, with fields replaced by `changes`. */
export function fixtureProfile(
  name: string,
  changes: Partial<ProductProfile> = {},
): ProductProfile {
  const text = readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', `${name}.json`),
    'utf8',
  );
  const reading = readProfile(text);
  if (reading.kind !== 'profile') {
    throw new Error(`fixture ${name} is unreadable: ${reading.reason}`);
  }
  return {...reading.profile, ...changes};
}
