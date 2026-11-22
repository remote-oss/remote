import {mkdirSync, utimesSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

/** The sweep floor the clean-ups use: an entry may go only past ten minutes, aged past it here. */
const FLOOR_MILLISECONDS = 11 * 60_000;

/** The mtime of the entries, past the sweep floor, so only the pid check can keep them. */
export function agePastFloor(folder: string, names: readonly string[]): void {
  const aged = new Date(Date.now() - FLOOR_MILLISECONDS);
  for (const name of names) {
    utimesSync(path.join(folder, name), aged, aged);
  }
}

/** A stage of a process the row started and ended, with its .stage. and .archive. entries, aged past the floor. */
export function deadStage(folder: string, prefix: string): string {
  const ended = spawnSync('true');
  const stage = `${prefix}.${String(ended.pid)}`;
  mkdirSync(path.join(folder, stage), {recursive: true});
  mkdirSync(path.join(folder, `${stage}.stage.${String(ended.pid)}`), {
    recursive: true,
  });
  writeFileSync(path.join(folder, `${stage}.archive.${String(ended.pid)}`), '');
  agePastFloor(folder, [
    stage,
    `${stage}.stage.${String(ended.pid)}`,
    `${stage}.archive.${String(ended.pid)}`,
  ]);
  return stage;
}

/** The stage of the test's own pid, with its .stage. and .archive. entries where asked, aged past the floor. */
export function liveStage(
  folder: string,
  prefix: string,
  withEntries: boolean,
): string {
  const stage = `${prefix}.${String(process.pid)}`;
  const names = [stage];
  mkdirSync(path.join(folder, stage), {recursive: true});
  if (withEntries) {
    mkdirSync(path.join(folder, `${stage}.stage.${String(process.pid)}`), {
      recursive: true,
    });
    writeFileSync(
      path.join(folder, `${stage}.archive.${String(process.pid)}`),
      '',
    );
    names.push(
      `${stage}.stage.${String(process.pid)}`,
      `${stage}.archive.${String(process.pid)}`,
    );
  }
  agePastFloor(folder, names);
  return stage;
}

/** A stage directory only, of a process the row started and ended. */
export function bareStage(folder: string, prefix: string): string {
  const ended = spawnSync('true');
  const stage = `${prefix}.${String(ended.pid)}`;
  mkdirSync(path.join(folder, stage), {recursive: true});
  return stage;
}
