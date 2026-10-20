/**
 * @fileoverview The client's netrc file over `node:fs`: the file `NETRC` names when it is set, else `.netrc` in the
 * home folder and, on Windows, `_netrc` there.
 */

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {CredentialsPort} from './ports.ts';

/** What the client's netrc is found from. */
export interface NetrcPlaces {
  environment: Readonly<Record<string, string | undefined>>;
  platform: string;
  homeFolder: string;
}

/** The text of `file`, or undefined when it does not exist; any other failure is thrown. */
async function textOf(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw caught;
  }
}

/** The credentials port over the client's files. */
export function nodeCredentialsPort(places: NetrcPlaces): CredentialsPort {
  return {
    readNetrc: async () => {
      const named = places.environment.NETRC;
      if (named !== undefined && named !== '') {
        return textOf(named);
      }
      const candidates = [path.join(places.homeFolder, '.netrc')];
      if (places.platform === 'win32') {
        candidates.push(path.join(places.homeFolder, '_netrc'));
      }
      for (const candidate of candidates) {
        const text = await textOf(candidate);
        if (text !== undefined) {
          return text;
        }
      }
      return undefined;
    },
  };
}
