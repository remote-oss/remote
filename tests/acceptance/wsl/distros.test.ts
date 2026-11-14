import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  listedDistros,
  type WslDistros,
  wslText,
} from '../../../tools/acceptance-wsl.ts';
import {variable} from '../windows/harness.ts';

/** What `wsl.exe` prints for `programArguments`, as plain text, and its status. */
function wsl(programArguments: readonly string[]): {
  status: number | null;
  text: string;
} {
  const result = spawnSync('wsl.exe', programArguments, {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    status: result.status,
    text: wslText(`${result.stdout}${result.stderr}`).trim(),
  };
}

describe('the WSL distros of a Windows client (card #2355)', function () {
  this.timeout(180_000);

  it('contracts harness: the installed distro is WSL 2 and the default, the launch’s own two are WSL 2 and WSL 1, and each answers a command', () => {
    const distros = JSON.parse(
      variable('HARNESS_WSL_DISTROS'),
    ) as WslDistros;
    const listing = wsl(['-l', '-v']);
    const listed = listedDistros(listing.text);
    deepStrictEqual(
      [
        listing.status,
        ...[distros.installed, distros.wsl2, distros.wsl1].map(name => {
          const distro = listed.find(each => each.name === name);
          const answer = wsl(['-d', name, '--exec', 'echo', name]);
          return [
            name,
            distro?.version,
            distro?.isDefault,
            answer.status,
            answer.text,
          ];
        }),
      ],
      [
        0,
        [distros.installed, '2', true, 0, distros.installed],
        [distros.wsl2, '2', false, 0, distros.wsl2],
        [distros.wsl1, '1', false, 0, distros.wsl1],
      ],
    );
  });
});
