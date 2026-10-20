/**
 * @fileoverview The two reads of a pre-connection script's file on this machine.
 */

import {lstat, readFile} from 'node:fs/promises';
import type {PreconnectPorts} from './ports.ts';

/** The reads over Node: the file's bytes, and whether anything exists at the path. */
export const nodePreconnectFiles: Pick<PreconnectPorts, 'readFile' | 'exists'> =
  {
    readFile: file => readFile(file),
    exists: async file => {
      try {
        await lstat(file);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    },
  };
