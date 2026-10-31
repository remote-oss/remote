/**
 * @fileoverview What the rows on the Dev Containers view of the Remote Explorer share: its name and a wait for its
 * rows.
 */

import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {variable, waitFor} from './harness.ts';
import {rowDetails, type RowDetails} from './renderer.ts';

/** The name of the view. */
export const VIEW = 'Dev Containers';

/** Waits until the view of window `name` has rows that `ready` accepts, and gives them. */
export async function rowsWhen(
  name: string,
  ready: (rows: RowDetails[]) => boolean,
  milliseconds = 60_000,
): Promise<RowDetails[]> {
  let shown: RowDetails[] = [];
  await waitFor(
    `the rows of ${VIEW} in window ${name}`,
    async () => {
      try {
        shown = (await rowDetails(name, VIEW)) ?? [];
      } catch {
        return false;
      }
      return ready(shown);
    },
    milliseconds,
  );
  return shown;
}

/** A program for `dev.containers.dockerPath` that runs `intercept` first, and then passes the call on to docker. */
export function dockerWrapper(name: string, intercept: string): string {
  const wrapper = path.join(variable('HARNESS_RUN_FOLDER'), name);
  writeFileSync(wrapper, `#!/bin/sh\n${intercept}\nexec docker "$@"\n`, {
    mode: 0o755,
  });
  return wrapper;
}
