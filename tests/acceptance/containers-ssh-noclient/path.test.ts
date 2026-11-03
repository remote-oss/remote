/**
 * @fileoverview The launch whose editor's PATH holds `docker` and no `ssh` (card tooling-123), for the rows that need a
 * client with no SSH program: its folder holds `docker` alone, and that `docker` answers.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {promisify} from 'node:util';
import {dockerOnlyFolder, writeSshClient} from '../windows/engine-fixture.ts';

const execFileAsync = promisify(execFile);

describe('the launch with docker and no ssh (card tooling-123)', function () {
  this.timeout(120_000);

  it('tooling-123 (noclient-path): the folder that is the editor’s whole PATH holds docker alone, and that docker reaches the run’s daemon', async () => {
    await writeSshClient();
    const {stdout} = await execFileAsync(
      'docker',
      ['version', '--format', '{{.Server.Os}}'],
      {env: {...process.env, PATH: dockerOnlyFolder()}},
    );
    deepStrictEqual(
      {programs: readdirSync(dockerOnlyFolder()), server: stdout.trim()},
      {programs: ['docker'], server: 'linux'},
    );
  });
});
