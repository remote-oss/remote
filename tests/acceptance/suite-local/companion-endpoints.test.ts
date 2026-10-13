import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import * as vscode from 'vscode';

const ENVELOPE = {interfaceVersion: {major: 1, minor: 0}};

/** The host aliases of the run's ssh_config in file order: the words after `Host` that are not patterns. */
function expectedHostnames(): string[] {
  return readFileSync(process.env.HARNESS_SSH_CONFIG ?? '', 'utf8')
    .split('\n')
    .flatMap(line => {
      const words = line.trim().split(/\s+/);
      return words[0]?.toLowerCase() === 'host'
        ? words
            .slice(1)
            .filter(
              word =>
                !word.includes('*') &&
                !word.includes('?') &&
                !word.startsWith('!'),
            )
        : [];
    });
}

describe('the commands remote-ssh serves to Remote Explorer', () => {
  it("ssh-provider-01: the host list answers with the run's ssh_config hosts in file order", async () => {
    const answer = await vscode.commands.executeCommand(
      'remote-internal.getConfiguredHostnames',
      ENVELOPE,
    );
    deepStrictEqual(answer, {...ENVELOPE, hostnames: expectedHostnames()});
  });

  it("ssh-provider-01: the first host of the run's ssh_config is harness", () => {
    deepStrictEqual(expectedHostnames()[0], 'harness');
  });

  it('ssh-provider-01: the active remote of a local window is none, at once', async () => {
    const started = Date.now();
    const answer = await vscode.commands.executeCommand(
      'remote-internal.getActiveSshRemote',
      ENVELOPE,
    );
    deepStrictEqual(
      [answer, Date.now() - started < 1000],
      [{...ENVELOPE, connected: false}, true],
    );
  });

  it('ssh-provider-01: the active remote with no argument is none too', async () => {
    deepStrictEqual(
      await vscode.commands.executeCommand(
        'remote-internal.getActiveSshRemote',
      ),
      {...ENVELOPE, connected: false},
    );
  });
});
