/**
 * @fileoverview The pinned OpenSSH client of the `ssh-newclient` launch. `tools/install-openssh` builds it once into a
 * cache folder named by its version and digest and prints the path of its `ssh`; the launch's Remote - SSH runs it
 * through `remote.SSH.path` and its rows read the same path from HARNESS_SSH_CLIENT, so the product and the rows' own
 * `ssh` calls use one client.
 */

import path from 'node:path';
import type {CommandRunner} from './command-runner.ts';

/** How many of the build's last lines a refusal quotes. */
const BUILD_LINES_QUOTED = 10;

/**
 * The path of the pinned client's `ssh`, from `tools/install-openssh` under `root`, after a line to `report` with what
 * its `ssh -V` prints. A build that fails refuses the launch with the build's last lines, so a run never goes on with
 * the machine's own client.
 */
export function pinnedSshClient(
  command: CommandRunner,
  root: string,
  report: (line: string) => void,
): string {
  const built = command(path.join(root, 'tools', 'install-openssh'), []);
  const client = built.stdout.trim().split('\n').at(-1) ?? '';
  if (built.status !== 0 || client === '') {
    const lines = built.stderr.trim().split('\n').slice(-BUILD_LINES_QUOTED);
    throw new Error(
      `the ssh-newclient launch needs the pinned OpenSSH client, and tools/install-openssh failed (${String(built.status)}): ${lines.join('\n')}`,
    );
  }
  const version = command(client, ['-V']);
  report(
    `acceptance: the pinned OpenSSH client ${client}: ${(version.stderr || version.stdout).trim()}`,
  );
  return client;
}
