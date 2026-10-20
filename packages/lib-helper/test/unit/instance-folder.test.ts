import {deepStrictEqual} from 'node:assert';
import {instanceRegistryFolder} from '../../src/index.ts';

describe('the instance registry folder', () => {
  it("resolves from the default profile's global storage", () => {
    deepStrictEqual(
      instanceRegistryFolder(
        '/home/user/.config/VSCodium/User/globalStorage/remote-oss.remote-containers',
      ),
      {
        kind: 'resolved',
        folder:
          '/home/user/.config/VSCodium/User/globalStorage/remote-oss.remote-containers/instance-registry',
      },
    );
  });

  it("resolves a named profile's global storage to the default profile's folder", () => {
    deepStrictEqual(
      instanceRegistryFolder(
        '/home/user/.config/VSCodium/User/profiles/5c2a1f/globalStorage/remote-oss.remote-containers',
      ),
      {
        kind: 'resolved',
        folder:
          '/home/user/.config/VSCodium/User/globalStorage/remote-oss.remote-containers/instance-registry',
      },
    );
  });

  it('resolves under a --user-data-dir folder', () => {
    deepStrictEqual(
      instanceRegistryFolder('/tmp/run/user-data/User/globalStorage/x'),
      {
        kind: 'resolved',
        folder: '/tmp/run/user-data/User/globalStorage/x/instance-registry',
      },
    );
  });

  it('reads from the end, so a user-data folder whose path holds a User segment resolves', () => {
    deepStrictEqual(
      instanceRegistryFolder(
        '/home/User/.config/VSCodium/User/profiles/abc/globalStorage/x',
      ),
      {
        kind: 'resolved',
        folder:
          '/home/User/.config/VSCodium/User/globalStorage/x/instance-registry',
      },
    );
  });

  it('resolves a Windows path in Windows form', () => {
    deepStrictEqual(
      instanceRegistryFolder(
        'C:\\Users\\user\\AppData\\Roaming\\VSCodium\\User\\profiles\\abc\\globalStorage\\x',
      ),
      {
        kind: 'resolved',
        folder:
          'C:\\Users\\user\\AppData\\Roaming\\VSCodium\\User\\globalStorage\\x\\instance-registry',
      },
    );
  });

  it('leaves a folder without globalStorage, a profile without an id and an empty extension folder unresolved, with no per-user fallback', () => {
    deepStrictEqual(
      [
        '/home/user/.config/VSCodium/User/storage/x',
        '/home/user/.config/VSCodium/User/profiles/globalStorage/x',
        '/home/user/.config/VSCodium/User/globalStorage/',
      ].map(folder => instanceRegistryFolder(folder)),
      [{kind: 'unresolved'}, {kind: 'unresolved'}, {kind: 'unresolved'}],
    );
  });
});
