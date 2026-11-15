import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {pinnedSshClient} from './acceptance-ssh-client.ts';
import type {CommandResult, CommandRunner} from './command-runner.ts';

const CLIENT = '/cache/remote-oss/openssh-10.6p2-9ae44872090c/bin/ssh';

/** A command runner that records each call and answers by the program it runs. */
function recording(answers: Readonly<Record<string, CommandResult>>): {
  calls: string[][];
  command: CommandRunner;
} {
  const calls: string[][] = [];
  return {
    calls,
    command: (program, programArguments) => {
      calls.push([program, ...programArguments]);
      return answers[program] ?? {status: 0, stdout: '', stderr: ''};
    },
  };
}

/** The message a refused launch gives, or `not refused`. */
function refusalOf(command: CommandRunner): string {
  try {
    pinnedSshClient(command, '/repo', () => undefined);
    return 'not refused';
  } catch (error) {
    return error instanceof Error ? error.message : 'other';
  }
}

describe('the pinned OpenSSH client of the ssh-newclient launch (card #2600)', () => {
  it('#2600: the client is the path the install script prints last, and its ssh -V is reported once', () => {
    const script = path.join('/repo', 'tools', 'install-openssh');
    const world = recording({
      [script]: {
        status: 0,
        stdout: `${CLIENT}\n`,
        stderr: 'OpenSSH_10.6p2, without OpenSSL\n',
      },
      [CLIENT]: {
        status: 0,
        stdout: '',
        stderr: 'OpenSSH_10.6p2, without OpenSSL\n',
      },
    });
    const lines: string[] = [];
    deepStrictEqual(
      [
        pinnedSshClient(world.command, '/repo', line => {
          lines.push(line);
        }),
        world.calls,
        lines,
      ],
      [
        CLIENT,
        [[script], [CLIENT, '-V']],
        [
          `acceptance: the pinned OpenSSH client ${CLIENT}: OpenSSH_10.6p2, without OpenSSL`,
        ],
      ],
    );
  });

  it('#2600: a build that fails refuses the launch with its last lines, and the machine’s own client is never run', () => {
    const script = path.join('/repo', 'tools', 'install-openssh');
    const build = [...Array(12).keys()].map(
      index => `line ${String(index + 1)}`,
    );
    const world = recording({
      [script]: {
        status: 1,
        stdout: '',
        stderr: `${build.join('\n')}\ninstall-openssh: cc is missing, and building OpenSSH 10.6p2 needs it\n`,
      },
    });
    const refused = refusalOf(world.command);
    deepStrictEqual(
      [refused, world.calls],
      [
        `the ssh-newclient launch needs the pinned OpenSSH client, and tools/install-openssh failed (1): ${[...build.slice(-9), 'install-openssh: cc is missing, and building OpenSSH 10.6p2 needs it'].join('\n')}`,
        [[script]],
      ],
    );
  });

  it('#2600: a script that ends well but prints no path refuses the launch too', () => {
    const script = path.join('/repo', 'tools', 'install-openssh');
    const world = recording({
      [script]: {status: 0, stdout: '\n', stderr: 'nothing built\n'},
    });
    const refused = refusalOf(world.command);
    deepStrictEqual(
      refused,
      'the ssh-newclient launch needs the pinned OpenSSH client, and tools/install-openssh failed (0): nothing built',
    );
  });
});
