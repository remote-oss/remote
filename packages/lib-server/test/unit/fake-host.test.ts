import {deepStrictEqual} from 'node:assert';
import {existsSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fakeHost, removeFakeHosts} from './fake-host.ts';

describe('the fake host folders', () => {
  it('server-17: a host root is gone after its folders are cleaned up', () => {
    const host = fakeHost();
    const root = path.dirname(host.home);
    removeFakeHosts();
    deepStrictEqual(existsSync(root), false);
  });

  it('server-17: every host root made since the last cleanup is gone', () => {
    const roots = [fakeHost(), fakeHost()].map(host => path.dirname(host.home));
    removeFakeHosts();
    deepStrictEqual(
      roots.map(root => existsSync(root)),
      [false, false],
    );
  });

  it('server-17: a root that is already gone is not an error', () => {
    const host = fakeHost();
    const root = path.dirname(host.home);
    rmSync(root, {recursive: true, force: true});
    removeFakeHosts();
    deepStrictEqual(existsSync(root), false);
  });

  it('server-17: a second cleanup with nothing left changes nothing', () => {
    const host = fakeHost();
    removeFakeHosts();
    removeFakeHosts();
    deepStrictEqual(existsSync(path.dirname(host.home)), false);
  });
});
