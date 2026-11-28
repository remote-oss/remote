/**
 * @fileoverview The tunnels conformance run, the suite's one command: it starts the run's stack, runs every row with a
 * line for each and the run's time, removes the stack, and exits non-zero on a red the known-red list doesn't excuse.
 */

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runCommand} from '../../tools/command-runner.ts';
import {readKnownReds} from '../../tools/known-reds.ts';
import {CONFORMANCE_LAUNCH, runRows, verdictLinesOf} from './conformance.ts';
import {ROWS} from './rows.ts';
import {namesOf, startStack, stopStack} from './stack.ts';

/** How long the relay gets to print its ready line, in milliseconds. */
const READY_MILLISECONDS = 30000;

const started = Date.now();
const folder = mkdtempSync(path.join(tmpdir(), 'tunnels-run-'));
const domain = `${path.basename(folder).toLowerCase()}.tunnels.test`;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function removeStack(): void {
  stopStack(runCommand, namesOf(folder));
  rmSync(folder, {recursive: true, force: true});
}

process.once('SIGINT', () => {
  removeStack();
  process.exit(130);
});
process.once('SIGTERM', () => {
  removeStack();
  process.exit(143);
});

let passes = false;
try {
  const stack = await startStack(runCommand, {
    domain,
    folder,
    published: false,
    readyMilliseconds: READY_MILLISECONDS,
  });
  const outcome = await runRows(ROWS, stack, write);
  const verdict = verdictLinesOf(
    outcome,
    readKnownReds(path.join(import.meta.dirname, '..', '..')),
    process.env.GITHUB_EVENT_NAME === 'pull_request',
  );
  verdict.lines.forEach(write);
  passes = verdict.passes;
  write(
    `${CONFORMANCE_LAUNCH}: ${String(outcome.passes.length)} passing, ${String(outcome.failures.length)} failing in ${String(Math.round((Date.now() - started) / 1000))} s`,
  );
} catch (failure) {
  write(`${CONFORMANCE_LAUNCH}: the stack did not start: ${String(failure)}`);
} finally {
  removeStack();
}
process.exit(passes ? 0 : 1);
