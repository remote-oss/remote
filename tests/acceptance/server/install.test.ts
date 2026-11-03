import {deepStrictEqual} from 'node:assert';
import {startHost, type RunningHost} from './host-fixture.ts';
import {
  HOST_ARCHIVE,
  hostArchiveOf,
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
    placeStandInArchive(host, 'serving', 'rooted');
  });

  after(() => {
    host.stop();
  });

  it('installs the archive on the host (F-2407)', async () => {
    deepStrictEqual(await installStatus(host, parametersFor()), 'Ok');
  });

  it('unpacks it into the commit folder without its top folder (F-2407)', async () => {
    const parameters = parametersFor();
    await installStatus(host, parameters);
    deepStrictEqual(
      host.onHost('ls', installFolderOf(parameters)).split('\n'),
      ['bin', 'product.json', ''],
    );
  });

  it('unpacks an archive packed without a wrapper folder, its entries starting with ./, keeping its folders (F-2407)', async () => {
    const parameters = parametersFor({
      archivePath: hostArchiveOf('serving', 'rooted'),
    });
    await installStatus(host, parameters);
    deepStrictEqual(
      host.onHost('ls', installFolderOf(parameters)).split('\n'),
      ['bin', 'product.json', ''],
    );
  });

  it('leaves the launcher executable for the user (F-2407)', async () => {
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

  it('finds the server installed on a second install and succeeds (F-2407)', async () => {
    const parameters = parametersFor();
    await installStatus(host, parameters);
    deepStrictEqual(await installStatus(host, parameters), 'Ok');
  });

  it('keeps the archive it was given unless told to remove it (F-2407)', async () => {
    await installStatus(host, parametersFor());
    deepStrictEqual(
      host.onHost('sh', '-c', `test -f '${HOST_ARCHIVE}' && echo kept`).trim(),
      'kept',
    );
  });

  it('contracts V4: removes a copied archive after the install', async () => {
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

  it('reports an archive that cannot be unpacked (F-2407)', async () => {
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
