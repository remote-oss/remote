/**
 * @fileoverview docker-containerd-store: the `docker info` formats the script reads are ones the daemon formats.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runCommand} from './command-runner.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** The formats the script gives `docker info`, in its order: the store's line, then the mirrors'. */
const FORMATS = [
  ...readFileSync(
    path.join(REPOSITORY_ROOT, 'tools', 'docker-containerd-store'),
    'utf8',
  ).matchAll(/docker info --format '([^']+)'/g),
].map(match => String(match[1]));

describe('docker-containerd-store (card tooling-173)', () => {
  it("tooling-173: the daemon formats the script's store line and its mirrors, the mirrors as a JSON list", function () {
    // A real daemon's first calls can take seconds on a busy hosted runner, past mocha's 10 s.
    this.timeout(60_000);
    if (runCommand('docker', ['info', '--format', '{{.ID}}']).status !== 0) {
      this.skip();
    }
    const [store, mirrors] = FORMATS.map(format =>
      runCommand('docker', ['info', '--format', format]),
    );
    const listed = JSON.parse(mirrors?.stdout ?? '') as unknown;
    deepStrictEqual(
      [
        FORMATS.length,
        store?.status,
        /^\S+ \S*$/.test(store?.stdout.trim() ?? ''),
        mirrors?.status,
        listed === null || Array.isArray(listed),
      ],
      [2, 0, true, 0, true],
    );
  });
});
