/**
 * @fileoverview The rows for the launch's script and signal files (card tooling-26): the append is atomic, so a
 * reader during the append sees the old list or the new one, and the signal of a held entry is created by name,
 * the reserved one refused.
 */

import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {appendScriptTo, signalFile, type AppendedEntry} from './script-file.ts';

describe('script-file (card tooling-26)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'script-file-'));
  });

  afterEach(() => {
    rmSync(workspace, {recursive: true, force: true});
  });

  describe('appendScriptTo', () => {
    const FIRST: AppendedEntry = {
      surface: 'pick',
      match: 'authenticity',
      answer: 'yes',
    };
    const SECOND: AppendedEntry = {
      surface: 'pick',
      match: 'sure',
      answer: 'no',
    };

    it('appends to the list the script holds', () => {
      const script = path.join(workspace, 'script.json');
      writeFileSync(script, JSON.stringify({entries: [FIRST]}));
      appendScriptTo(script, [SECOND]);
      deepStrictEqual(JSON.parse(readFileSync(script, 'utf8')), {
        entries: [FIRST, SECOND],
      });
    });

    it('starts the list when the script does not exist yet', () => {
      const script = path.join(workspace, 'script.json');
      appendScriptTo(script, [FIRST]);
      deepStrictEqual(JSON.parse(readFileSync(script, 'utf8')), {
        entries: [FIRST],
      });
    });

    it('keeps a hostPick entry unchanged, whether it answers a label, a typed text or a dismissal', () => {
      const script = path.join(workspace, 'script.json');
      const entries: AppendedEntry[] = [
        {surface: 'hostPick', match: 'host', answer: {label: 'harness'}},
        {surface: 'hostPick', match: 'host', answer: {typed: 'ssh@host'}},
        {surface: 'hostPick', match: 'host', answer: 'dismiss'},
      ];
      appendScriptTo(script, entries);
      deepStrictEqual(JSON.parse(readFileSync(script, 'utf8')), {entries});
    });

    it('keeps a filePick entry unchanged, whether it answers a label or a dismissal', () => {
      const script = path.join(workspace, 'script.json');
      const entries: AppendedEntry[] = [
        {surface: 'filePick', match: 'file', answer: {label: '/run/config'}},
        {surface: 'filePick', match: 'file', answer: 'dismiss'},
      ];
      appendScriptTo(script, entries);
      deepStrictEqual(JSON.parse(readFileSync(script, 'utf8')), {entries});
    });

    it('leaves no partial file: a reader during the append sees the old or the new list', async function () {
      this.timeout(30_000);
      const script = path.join(workspace, 'script.json');
      const stopFile = path.join(workspace, 'stop');
      writeFileSync(script, JSON.stringify({entries: []}));
      // The reader: it loops over the script until the stop file exists, posting every read and every failure.
      const worker = new Worker(
        [
          "const {parentPort} = require('node:worker_threads');",
          "const {existsSync, readFileSync} = require('node:fs');",
          "parentPort.on('message', ([scriptFile, stopFile]) => {",
          '  while (!existsSync(stopFile)) {',
          '    try {',
          "      const {entries} = JSON.parse(readFileSync(scriptFile, 'utf8'));",
          '      parentPort.postMessage({ok: true, count: entries.length});',
          '    } catch {',
          '      parentPort.postMessage({ok: false, count: -1});',
          '    }',
          '  }',
          '  parentPort.close();',
          '});',
        ].join('\n'),
        {eval: true},
      );
      const observed: Array<{ok: boolean; count: number}> = [];
      let workerError: Error | undefined;
      const finished = new Promise<void>(resolve => {
        worker.on('exit', () => {
          resolve();
        });
      });
      worker.on('error', (error: Error) => {
        workerError = error;
      });
      worker.on('message', (message: {ok: boolean; count: number}) => {
        observed.push(message);
      });
      worker.postMessage([script, stopFile]);
      // A turn of the event loop between the appends, so the reader reads between them.
      const appends = 100;
      const appended: AppendedEntry[] = Array.from(
        {length: appends},
        (each, index) => ({
          surface: 'pick',
          match: `m${String(index)}`,
          answer: 'yes',
        }),
      );
      for (const entry of appended) {
        appendScriptTo(script, [entry]);
        await new Promise(resolve => {
          setTimeout(resolve, 1);
        });
      }
      writeFileSync(stopFile, '');
      await finished;
      const issues: string[] = [];
      if (workerError !== undefined) {
        issues.push(`the reader worker died: ${workerError.message}`);
      }
      // Every read of the script parsed: a partial write would fail the reader's JSON parse.
      for (const each of observed) {
        if (!each.ok) {
          issues.push('a reader saw a partial file');
        }
      }
      // And every read held the old list or a newer one: the counts never shrink, and none passes the final list.
      let previous = -1;
      for (const count of observed.map(each => each.count)) {
        if (count < previous) {
          issues.push('the reader saw the list shrink');
        }
        if (count > appends) {
          issues.push('a reader saw a list of a size the append never held');
        }
        previous = count;
      }
      const finalScript = JSON.parse(readFileSync(script, 'utf8')) as {
        entries: AppendedEntry[];
      };
      if (finalScript.entries.length !== appends) {
        issues.push('the final list is not the appended one');
      }
      if (
        existsSync(
          path.join(workspace, `script.json.${String(process.pid)}.tmp`),
        )
      ) {
        issues.push('the temporary file is left behind');
      }
      deepStrictEqual(issues, []);
    });
  });

  describe('signalFile', () => {
    it('creates the signal file in the run signals folder', () => {
      signalFile(path.join(workspace, 'signals'), 'h1-go');
      strictEqual(existsSync(path.join(workspace, 'signals', 'h1-go')), true);
    });

    it('refuses the reserved name never', () => {
      throws(
        () => {
          signalFile(path.join(workspace, 'signals'), 'never');
        },
        {
          message:
            "the signal name 'never' is reserved for an answer that must never come",
        },
      );
    });
  });
});
