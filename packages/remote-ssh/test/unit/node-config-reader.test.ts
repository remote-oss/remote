import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeConfigReader} from '../../src/connect/node-config-reader.ts';

describe('the client files of the host list (card connect-21)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'config-reader-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('connect-21: the text of a readable file is read', () => {
    writeFileSync(path.join(root, 'config'), 'Host dev\n');
    strictEqual(
      nodeConfigReader.readText(path.join(root, 'config')),
      'Host dev\n',
    );
  });

  it('connect-21: a missing file reads as nothing', () => {
    strictEqual(
      nodeConfigReader.readText(path.join(root, 'absent')),
      undefined,
    );
  });

  it('connect-21: a folder where a file was expected reads as nothing', () => {
    strictEqual(nodeConfigReader.readText(root), undefined);
  });

  it('connect-21: a file that cannot be read reads as nothing', function () {
    if (process.getuid?.() === 0) {
      this.skip();
    }
    const file = path.join(root, 'locked');
    writeFileSync(file, 'Host dev\n');
    chmodSync(file, 0o000);
    strictEqual(nodeConfigReader.readText(file), undefined);
  });

  it('connect-21: the entries of a readable folder are listed', () => {
    mkdirSync(path.join(root, 'conf.d'));
    writeFileSync(path.join(root, 'conf.d', 'a.conf'), '');
    deepStrictEqual(nodeConfigReader.listFolder(path.join(root, 'conf.d')), [
      'a.conf',
    ]);
  });

  it('connect-21: a missing folder lists nothing', () => {
    strictEqual(
      nodeConfigReader.listFolder(path.join(root, 'absent')),
      undefined,
    );
  });

  it('connect-21: a file where a folder was expected lists nothing', () => {
    writeFileSync(path.join(root, 'config'), '');
    strictEqual(
      nodeConfigReader.listFolder(path.join(root, 'config')),
      undefined,
    );
  });
});
