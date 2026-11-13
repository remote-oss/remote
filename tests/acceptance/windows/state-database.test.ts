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

  it('tooling-207: a writer that never commits fails the read within its bound, naming the journal, the files beside the database, the process holding them and the journal mode', async () => {
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
        message.includes('a writer’s journal is present'),
        message.includes('"state.vscdb'),
        message.includes('journal mode'),
        message.includes(`${String(writer.pid)}: `),
        Date.now() - started < 4000,
      ],
      [true, true, true, true, true, true],
      message,
    );
  });

  it('tooling-207: a writer with no busy timeout loses no commit to the reads polling beside it', async () => {
    const script = `
      const {DatabaseSync} = require('node:sqlite');
      const database = new DatabaseSync(process.argv[1]);
      let failures = 0;
      for (let each = 0; each < 400; each += 1) {
        try {
          database.exec('BEGIN');
          database.exec("INSERT OR REPLACE INTO ItemTable VALUES ('k" + (each % 5) + "', '" + each + "')");
          database.exec('COMMIT');
        } catch {
          failures += 1;
          try { database.exec('ROLLBACK'); } catch {}
        }
      }
      process.stdout.write('failures ' + failures + '\\n');
    `;
    const child = spawn(process.execPath, ['-e', script, file], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const state = {running: true};
    void new Promise(resolve => child.once('close', resolve)).then(() => {
      state.running = false;
    });
    while (state.running) {
      readStateDatabase(file, keys);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    deepStrictEqual(output.trim(), 'failures 0');
  });

  it('tooling-207: a read that is still open takes no lock: a writer with no busy timeout commits beside it', () => {
    const outcome: {commit: string; reads: string[]} = {
      commit: 'not run',
      reads: [],
    };
    readStateDatabase(file, database => {
      outcome.reads = keys(database);
      const open = database.prepare('SELECT key FROM ItemTable').iterate();
      open.next();
      if (outcome.commit !== 'not run') {
        return;
      }
      const writer = new DatabaseSync(file);
      try {
        writer.exec(
          "INSERT OR REPLACE INTO ItemTable VALUES ('beside', 'two')",
        );
        outcome.commit = 'committed';
      } catch (caught) {
        outcome.commit = String(caught);
      } finally {
        writer.close();
      }
    });
    deepStrictEqual(outcome.commit, 'committed');
  });
});
