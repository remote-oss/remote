/**
 * @fileoverview The Windows SSH host of the `windows-host` launch. The platform workflow's Windows job starts Windows'
 * OpenSSH Server on 127.0.0.1 for the job's account, with key authentication only and Windows PowerShell as its shell,
 * and passes its port, user and key as HARNESS_WINHOST_*. The run gives the launch's windows the alias `winhost` for
 * it, and refuses the launch where there is no such server.
 */

import net from 'node:net';
import {sshConfigPath} from './acceptance-keys.ts';

/** The alias the `windows-host` launch's windows open. */
const WINDOWS_HOST_ALIAS = 'winhost';

/** The variables the platform workflow's Windows job exports for the run's Windows SSH host. */
export interface WindowsHostVariables {
  HARNESS_WINHOST_PORT?: string;
  HARNESS_WINHOST_USER?: string;
  HARNESS_WINHOST_IDENTITY?: string;
}

/** Whether something accepts a TCP connection on 127.0.0.1:`port` within `milliseconds`. */
export async function answersOn(
  port: number,
  milliseconds = 5000,
): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port});
    const end = (answered: boolean): void => {
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(milliseconds, () => {
      end(false);
    });
    socket.once('connect', () => {
      end(true);
    });
    socket.once('error', () => {
      end(false);
    });
  });
}

/**
 * The `winhost` block of the run's ssh_config, for the Windows SSH host that `environment` names, once its server
 * answers. A client that is not Windows (`platform`), a variable that is missing and a server that does not answer each
 * refuse the launch, so its rows never run against another host.
 */
export async function windowsHostBlock(
  environment: Readonly<WindowsHostVariables>,
  platform: NodeJS.Platform,
  knownHosts: string,
  answers: (port: number) => Promise<boolean> = answersOn,
): Promise<string> {
  if (platform !== 'win32') {
    throw new Error(
      `the windows-host launch needs a Windows client, whose OpenSSH Server the platform workflow starts; this one is ${platform}`,
    );
  }
  const port = Number(environment.HARNESS_WINHOST_PORT);
  const user = environment.HARNESS_WINHOST_USER ?? '';
  const identity = environment.HARNESS_WINHOST_IDENTITY ?? '';
  if (!Number.isInteger(port) || port <= 0 || user === '' || identity === '') {
    throw new Error(
      `the windows-host launch needs HARNESS_WINHOST_PORT, HARNESS_WINHOST_USER and HARNESS_WINHOST_IDENTITY, which the platform workflow's Windows job sets; this run has ${JSON.stringify(environment)}`,
    );
  }
  if (!(await answers(port))) {
    throw new Error(
      `the windows-host launch needs the Windows OpenSSH Server on 127.0.0.1:${String(port)}, and nothing answers there`,
    );
  }
  return [
    '',
    `Host ${WINDOWS_HOST_ALIAS}`,
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    `  User ${user}`,
    `  IdentityFile ${sshConfigPath(identity, platform)}`,
    '  IdentitiesOnly yes',
    '  IdentityAgent none',
    '  StrictHostKeyChecking accept-new',
    '  BatchMode yes',
    '  ConnectTimeout 10',
    `  UserKnownHostsFile ${sshConfigPath(knownHosts, platform)}`,
    '',
  ].join('\n');
}
