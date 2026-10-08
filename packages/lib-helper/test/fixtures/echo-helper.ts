/**
 * @fileoverview A helper script for the process test: it answers each request with its body.
 */

import {runHelper} from '../../src/index.ts';

void runHelper(
  {
    onRequest: body => Promise.resolve({echo: body}),
    runAction: () => Promise.resolve(),
  },
  () => undefined,
);
