import {deepStrictEqual} from 'node:assert';
import {startHost, type RunningHost} from './host-fixture.ts';
import {
  HOST_ARCHIVE,
  installFolderOf,
  installStatus,
  parametersFor,
  placeStandInArchive,
} from './support.ts';

describe('F-2407 the install of the server', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
    placeStandInArchive(host);
  });

  after(() => {
    host.stop();
  });

  it('F-2407: installs the archive on the host', async () => {
    deepStrictEqual(await installStatus(host, parametersFor()), 'Ok');
  });

  it('F-2407: unpacks it into the commit folder without its top folder', async () => {
    const parameters = parametersFor();
    await installStatus(host, parameters);
    deepStrictEqual(
      host.onHost('ls', installFolderOf(parameters)).split('\n'),
      ['bin', 'product.json', ''],
    );
  });

  it('F-2407: leaves the launcher executable for the user', async () => {
    const parameters = parametersFor();
    await installStatus(host, parameters);
    deepStrictEqual(
      host
        .onHost(
          'sh',
          '-c',
          `test -x '${installFolderOf(parameters)}/bin/stand-in-server' && echo executable`,
        )
        .trim(),
      'executable',
    );
  });

  it('F-2407: finds the server installed on a second install and succeeds', async () => {
    const parameters = parametersFor();
    await installStatus(host, parameters);
    deepStrictEqual(await installStatus(host, parameters), 'Ok');
  });

  it('F-2407: keeps the archive it was given unless told to remove it', async () => {
    await installStatus(host, parametersFor());
    deepStrictEqual(
      host.onHost('sh', '-c', `test -f '${HOST_ARCHIVE}' && echo kept`).trim(),
      'kept',
    );
  });

  it('F-3902.6: removes a copied archive after the install', async () => {
    host.onHost('cp', HOST_ARCHIVE, '/tmp/copied.tar.gz');
    await installStatus(
      host,
      parametersFor({archivePath: '/tmp/copied.tar.gz', removeArchive: true}),
    );
    deepStrictEqual(
      host
        .onHost('sh', '-c', 'test -e /tmp/copied.tar.gz || echo removed')
        .trim(),
      'removed',
    );
  });

  it('F-2407: reports an archive that cannot be unpacked', async () => {
    host.onHost('sh', '-c', 'echo not an archive > /tmp/broken.tar.gz');
    deepStrictEqual(
      await installStatus(
        host,
        parametersFor({archivePath: '/tmp/broken.tar.gz'}),
      ),
      'UnpackFailed',
    );
  });
});
