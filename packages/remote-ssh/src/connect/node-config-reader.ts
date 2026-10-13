/**
 * @fileoverview The client's configuration files over `node:fs`, as the host list reads them: the text of a readable
 * file, and the entry names of a readable folder. Anything else, a missing path, an unreadable one or a folder where a
 * file was expected, reads as nothing.
 */

import {readdirSync, readFileSync} from 'node:fs';
import type {ConfigFileReader} from 'lib-ssh';

/** The reader of the client's own files. */
export const nodeConfigReader: ConfigFileReader = {
  readText: file => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  },
  listFolder: folder => {
    try {
      return readdirSync(folder);
    } catch {
      return undefined;
    }
  },
};
