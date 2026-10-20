import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Writes the program at `<folder>/tools/dk` that records each call it gets in the run's file `calls` and passes it on
 * to Docker.
 */
export function folderWrapper(folder: string, calls: string): void {
  const wrapper = path.join(folder, 'tools', 'dk');
  mkdirSync(path.dirname(wrapper), {recursive: true});
  writeFileSync(
    wrapper,
    `#!/bin/sh\nprintf '%s\\n' "$*" >>"${calls}"\nexec docker "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
}

/** The calls the recording wrapper got, one per line; none when it was never run. */
export function recordedCalls(calls: string): string[] {
  return existsSync(calls)
    ? readFileSync(calls, 'utf8')
        .split('\n')
        .filter(line => line !== '')
    : [];
}
