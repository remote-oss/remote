import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {WindowManifest} from '../../src/open/command-window.ts';

/** The package's own `package.json`, as far as the windows its commands are offered in. */
export const SHIPPED_MANIFEST = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', '..', 'package.json'),
    'utf8',
  ),
) as WindowManifest;
