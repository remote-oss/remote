/**
 * @fileoverview What the rows of the host channel over real WSL share: running a program in the run's distro, the
 * readout lines, and the channel over the real `wsl.exe`.
 */

import type {HostChannel} from 'lib-host';
import {createWslHostChannel} from '../../../packages/lib-wsl/src/host-channel.ts';
import {createPathMapper} from '../../../packages/lib-wsl/src/path-mapper.ts';
import type {WslProcessSpawner} from '../../../packages/lib-wsl/src/process-port.ts';
import {createWslRunner} from '../../../packages/lib-wsl/src/runner.ts';
import {
  localFiles,
  localSession,
  localSpawner,
} from '../../../packages/remote-wsl/src/process/local-process.ts';
import {runCommand} from '../../../tools/command-runner.ts';
import type {WslDistros} from '../../../tools/acceptance-wsl.ts';
import {variable} from '../windows/harness.ts';

/** The run's installed distro, the one the channel rows use. */
export function installedDistro(): string {
  return (JSON.parse(variable('HARNESS_WSL_DISTROS')) as WslDistros).installed;
}

/** What `command` prints in `distro`, and its status. */
export function inDistro(
  distro: string,
  ...command: string[]
): {status: number; text: string} {
  const result = runCommand('wsl.exe', ['-d', distro, '--exec', ...command]);
  return {status: result.status, text: result.stdout.trim()};
}

/** A line of the run's readout: the time, what happened, and the distro's init start and uptime. */
export function readout(distro: string, what: string): void {
  const init = inDistro(
    distro,
    'sh',
    '-c',
    'stat -c %Y /proc/1; cut -d" " -f1 /proc/uptime',
  ).text.replaceAll('\n', ' uptime ');
  process.stdout.write(
    `readout ${new Date().toISOString()} ${what}: init started ${init}\n`,
  );
}

/** The channel to `distro` over the real `wsl.exe`, its spawner `spawner` unless the real one is meant. */
export function realChannel(
  distro: string,
  spawner: WslProcessSpawner = localSpawner,
): HostChannel {
  const runner = createWslRunner({
    spawner,
    files: localFiles,
    session: localSession(process.env),
  });
  return createWslHostChannel({
    runner,
    mapper: createPathMapper(runner),
    distro,
    logLine: message => {
      process.stderr.write(`${message}\n`);
    },
  });
}
