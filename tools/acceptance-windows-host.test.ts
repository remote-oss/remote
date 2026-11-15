import {deepStrictEqual} from 'node:assert';
import net from 'node:net';
import {
  answersOn,
  windowsHostBlock,
  type WindowsHostVariables,
} from './acceptance-windows-host.ts';

const VARIABLES: WindowsHostVariables = {
  HARNESS_WINHOST_PORT: '2222',
  HARNESS_WINHOST_USER: 'runneradmin',
  HARNESS_WINHOST_IDENTITY: 'C:\\a\\_temp\\winhost\\id_ed25519',
};

/** The message a refused launch gives, or `not refused`. */
async function refusalOf(
  environment: WindowsHostVariables,
  platform: NodeJS.Platform,
  answers: (port: number) => Promise<boolean>,
): Promise<string> {
  try {
    await windowsHostBlock(environment, platform, '/run/known_hosts', answers);
    return 'not refused';
  } catch (error) {
    return error instanceof Error ? error.message : 'other';
  }
}

describe('the Windows SSH host of the windows-host launch (card #2652)', () => {
  it('#2652: a Windows client whose server answers gets the winhost alias, its paths with forward slashes', async () => {
    const asked: number[] = [];
    deepStrictEqual(
      [
        await windowsHostBlock(
          VARIABLES,
          'win32',
          'C:\\run\\known_hosts',
          port => {
            asked.push(port);
            return Promise.resolve(true);
          },
        ),
        asked,
      ],
      [
        [
          '',
          'Host winhost',
          '  HostName 127.0.0.1',
          '  Port 2222',
          '  User runneradmin',
          '  IdentityFile C:/a/_temp/winhost/id_ed25519',
          '  IdentitiesOnly yes',
          '  IdentityAgent none',
          '  StrictHostKeyChecking accept-new',
          '  BatchMode yes',
          '  ConnectTimeout 10',
          '  UserKnownHostsFile C:/run/known_hosts',
          '',
        ].join('\n'),
        [2222],
      ],
    );
  });

  it('#2652: a client that is not Windows, a missing variable and a server that does not answer each refuse the launch', async () => {
    const answers = (): Promise<boolean> => Promise.resolve(true);
    deepStrictEqual(
      [
        await refusalOf(VARIABLES, 'linux', answers),
        await refusalOf(
          {...VARIABLES, HARNESS_WINHOST_USER: undefined},
          'win32',
          answers,
        ),
        await refusalOf(
          {...VARIABLES, HARNESS_WINHOST_PORT: 'none'},
          'win32',
          answers,
        ),
        await refusalOf(VARIABLES, 'win32', () => Promise.resolve(false)),
      ],
      [
        'the windows-host launch needs a Windows client, whose OpenSSH Server the platform workflow starts; this one is linux',
        `the windows-host launch needs HARNESS_WINHOST_PORT, HARNESS_WINHOST_USER and HARNESS_WINHOST_IDENTITY, which the platform workflow's Windows job sets; this run has ${JSON.stringify({...VARIABLES, HARNESS_WINHOST_USER: undefined})}`,
        `the windows-host launch needs HARNESS_WINHOST_PORT, HARNESS_WINHOST_USER and HARNESS_WINHOST_IDENTITY, which the platform workflow's Windows job sets; this run has ${JSON.stringify({...VARIABLES, HARNESS_WINHOST_PORT: 'none'})}`,
        'the windows-host launch needs the Windows OpenSSH Server on 127.0.0.1:2222, and nothing answers there',
      ],
    );
  });

  it('#2652: a port with a listener answers, and one with none does not', async () => {
    const server = net.createServer();
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const open = await answersOn(port);
    await new Promise<void>(resolve => {
      server.close(() => {
        resolve();
      });
    });
    deepStrictEqual([open, await answersOn(port, 1000)], [true, false]);
  });
});
