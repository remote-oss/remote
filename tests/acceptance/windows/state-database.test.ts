import {deepStrictEqual} from 'node:assert';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readStateDatabase} from './state-database.ts';

/** Holds an exclusive write transaction on `file` for `milliseconds` in another process, and resolves once it holds it. */
function holder(
  file: string,
  milliseconds: number,
): Promise<{process: ChildProcess}> {
  const script = `
    const {DatabaseSync} = require('node:sqlite');
    const database = new DatabaseSync(process.argv[1]);
    database.exec('BEGIN EXCLUSIVE');
    database.exec("INSERT OR REPLACE INTO ItemTable VALUES ('held', 'yes')");
    process.stdout.write('held\\n');
    setTimeout(() => { database.exec('COMMIT'); database.close(); }, ${String(milliseconds)});
  `;
  const child = spawn(process.execPath, ['-e', script, file], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', () => {
      resolve({process: child});
    });
  });
}

describe('the state database reader (card tooling-207)', function () {
  this.timeout(30_000);

  let folder = '';
  let file = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'state-database-'));
    file = path.join(folder, 'state.vscdb');
    const database = new DatabaseSync(file);
    database.exec(
      'CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)',
    );
    database.exec("INSERT INTO ItemTable VALUES ('before', 'one')");
    database.close();
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  function keys(database: DatabaseSync): string[] {
    return (
      database.prepare('SELECT key FROM ItemTable').all() as Array<{
        key: string;
      }>
    )
      .map(entry => entry.key)
      .sort();
  }

  it('tooling-207: a database no one holds is read at once', () => {
    deepStrictEqual(readStateDatabase(file, keys), ['before']);
  });

  it('tooling-207: a database held in an exclusive write transaction by another process is read once the writer commits, within the bound', async () => {
    const {process: writer} = await holder(file, 700);
    const started = Date.now();
    const seen = readStateDatabase(file, keys);
    const waited = Date.now() - started;
    writer.kill();
    deepStrictEqual([seen, waited < 5000], [['before', 'held'], true]);
  });

  it('tooling-207: a writer that never commits fails the read within its bound, naming SQLite’s code, the files beside the database and its journal mode', async () => {
    const {process: writer} = await holder(file, 60_000);
    const started = Date.now();
    let message = '';
    try {
      readStateDatabase(file, keys, 1500);
    } catch (caught) {
      message = (caught as Error).message;
    } finally {
      writer.kill();
    }
    deepStrictEqual(
      [
        message.includes('could not be read in 1500 ms'),
        /code \d+: /.test(message),
        message.includes('"state.vscdb'),
        message.includes('journal mode'),
        Date.now() - started < 4000,
      ],
      [true, true, true, true, true],
      message,
    );
  });
});
