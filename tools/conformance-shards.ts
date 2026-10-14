/**
 * @fileoverview The conformance replay workflow's scripts: the case names of a recorded suite that are valid on the
 * runners' platform, split into shards; the shards' summaries merged into one verdict; and the check that the VS Code
 * the workflow pins is the one the suite was recorded on.
 *
 * usage: node tools/conformance-shards.ts list <suite tests/conformance> <shards> <pinned VS Code version> <feature>...
 *          prints {"shards": [[names], ...], "count": n} as JSON (the replay matrix)
 *        node tools/conformance-shards.ts merge <folder holding one results folder per shard>
 *          prints the merged table as Markdown; exit 1 when any case failed or was not comparable
 */
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'yaml';
import {isMainModule} from './repository.ts';

/** The platform the replay runners are. */
export const RUNNER_PLATFORM = 'linux/x86_64';

/** What the workflow reads of a recorded case. */
export interface SuiteCase {
  readonly name: string;
  readonly status: string | undefined;
  readonly platforms: readonly string[];
  readonly vscodeVersion: string | undefined;
}

/** The platforms a case's expect is valid for: `recorded.platform` plus each platform `recorded.confirmed` lists. */
export function casePlatforms(recorded: unknown): string[] {
  if (typeof recorded !== 'object' || recorded === null) {
    return [];
  }
  const record = recorded as {platform?: unknown; confirmed?: unknown};
  const platforms: string[] =
    typeof record.platform === 'string' ? [record.platform] : [];
  const confirms: unknown[] = Array.isArray(record.confirmed)
    ? record.confirmed
    : [];
  for (const confirm of confirms) {
    const platform = (confirm as {platform?: unknown} | null)?.platform;
    if (typeof platform === 'string' && !platforms.includes(platform)) {
      platforms.push(platform);
    }
  }
  return platforms;
}

/** The cases of `feature` in a suite's `tests/conformance` folder, in name order. */
export function readCases(suite: string, feature: string): SuiteCase[] {
  const folder = join(suite, 'suite', feature);
  return readdirSync(folder)
    .filter(file => file.endsWith('.yaml'))
    .sort()
    .map(file => {
      const parsed = (parse(readFileSync(join(folder, file), 'utf8')) ??
        {}) as {
        id?: string;
        status?: string;
        recorded?: {vscode_version?: string};
      };
      return {
        name: parsed.id ?? file.slice(0, -'.yaml'.length),
        status: parsed.status,
        platforms: casePlatforms(parsed.recorded),
        vscodeVersion: parsed.recorded?.vscode_version,
      };
    });
}

/** The names the runners replay: recorded or flaky cases valid on `platform`; the others are not-applicable. */
export function replayable(
  cases: readonly SuiteCase[],
  platform = RUNNER_PLATFORM,
): string[] {
  return cases
    .filter(
      suiteCase =>
        (suiteCase.status === 'recorded' || suiteCase.status === 'flaky') &&
        suiteCase.platforms.includes(platform),
    )
    .map(suiteCase => suiteCase.name)
    .sort();
}

/** `names` dealt round-robin into `count` shards, in name order; no names gives one empty shard. */
export function shard(names: readonly string[], count: number): string[][] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `shards must be a whole number of at least 1: ${String(count)}`,
    );
  }
  if (names.length === 0) {
    return [[]];
  }
  const shards: string[][] = Array.from(
    {length: Math.min(count, names.length)},
    () => [],
  );
  [...names]
    .sort()
    .forEach((name, index) => shards[index % shards.length]?.push(name));
  return shards;
}

/** Throws unless every case in `names` was recorded on `pinned`, the workflow's VS Code. */
export function checkVscodePin(
  cases: readonly SuiteCase[],
  names: readonly string[],
  pinned: string,
): void {
  const versions = new Set(
    cases
      .filter(suiteCase => names.includes(suiteCase.name))
      .map(suiteCase => suiteCase.vscodeVersion ?? 'none'),
  );
  if ([...versions].some(version => version !== pinned)) {
    throw new Error(
      `the workflow pins VS Code ${pinned}, the suite's cases were recorded on ${[...versions].sort().join(', ')}`,
    );
  }
}

/** One case's outcome in a shard's `summary.json`. */
export interface CaseOutcome {
  readonly result: string;
  readonly reason?: string | null;
}

/** One shard's `summary.json`, as the runner writes it. */
export interface ShardSummary {
  readonly cases: Readonly<Record<string, CaseOutcome>>;
}

/** A failed or not-comparable case and its first difference. */
export interface FailingCase {
  readonly name: string;
  readonly result: string;
  readonly first: string;
}

/** The merged verdict: counts per feature and result, the failing cases, and whether the run passed. */
export interface Merged {
  readonly counts: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly failing: readonly FailingCase[];
  readonly passed: boolean;
}

/** The feature a case name belongs to: its leading `F-` and four digits. */
function featureOf(name: string): string {
  return /^F-\d{4}/.exec(name)?.[0] ?? name;
}

/**
 * The shards' summaries merged. `firstDifference` gives a failing case's first mismatch line. A failed or
 * not-comparable case makes the whole run fail, as the runner's own exit rule does, and so does a run where no case
 * applied.
 */
export function merge(
  summaries: readonly ShardSummary[],
  firstDifference: (name: string) => string,
): Merged {
  const counts: Record<string, Record<string, number>> = {};
  const failing: FailingCase[] = [];
  let applied = 0;
  for (const summary of summaries) {
    for (const [name, outcome] of Object.entries(summary.cases)) {
      const perFeature = (counts[featureOf(name)] ??= {});
      perFeature[outcome.result] = (perFeature[outcome.result] ?? 0) + 1;
      if (
        outcome.result !== 'not-applicable' &&
        outcome.result !== 'not-comparable'
      ) {
        applied += 1;
      }
      if (outcome.result === 'fail' || outcome.result === 'not-comparable') {
        failing.push({
          name,
          result: outcome.result,
          first: firstDifference(name) || (outcome.reason ?? ''),
        });
      }
    }
  }
  failing.sort((left, right) => left.name.localeCompare(right.name));
  return {counts, failing, passed: applied > 0 && failing.length === 0};
}

/** The merged verdict as the job summary's Markdown. */
export function markdown(merged: Merged): string {
  const results = ['pass', 'fail', 'not-applicable', 'not-comparable'];
  const lines = [
    `| feature | ${results.join(' | ')} |`,
    `|---|${results.map(() => '---|').join('')}`,
  ];
  for (const feature of Object.keys(merged.counts).sort()) {
    const cells = results.map(result =>
      String(merged.counts[feature]?.[result] ?? 0),
    );
    lines.push(`| ${feature} | ${cells.join(' | ')} |`);
  }
  if (merged.failing.length > 0) {
    lines.push('', '| case | result | first difference |', '|---|---|---|');
    for (const failed of merged.failing) {
      lines.push(
        `| ${failed.name} | ${failed.result} | ${failed.first.replaceAll('|', '\\|').slice(0, 300)} |`,
      );
    }
  }
  lines.push('', merged.passed ? '**Result: pass**' : '**Result: fail**');
  return lines.join('\n');
}

/** Every folder under `root` that holds a `summary.json`. */
function summaryFolders(root: string): string[] {
  const folders: string[] = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      folders.push(...summaryFolders(join(root, entry.name)));
    } else if (entry.name === 'summary.json') {
      folders.push(root);
    }
  }
  return folders;
}

/** The first mismatch line of a case's own result file in `folder`, or empty. */
function firstMismatch(folder: string, name: string): string {
  try {
    const result = JSON.parse(
      readFileSync(join(folder, `${name}.json`), 'utf8'),
    ) as {mismatches?: string[]};
    return result.mismatches?.[0] ?? '';
  } catch {
    return '';
  }
}

/** The shards' results under `root`, merged. */
export function mergeFolder(root: string): Merged {
  const folderOf = new Map<string, string>();
  const summaries = summaryFolders(root).map(folder => {
    const summary = JSON.parse(
      readFileSync(join(folder, 'summary.json'), 'utf8'),
    ) as ShardSummary;
    for (const name of Object.keys(summary.cases)) {
      folderOf.set(name, folder);
    }
    return summary;
  });
  return merge(summaries, name =>
    firstMismatch(folderOf.get(name) ?? root, name),
  );
}

/** The command line; returns the exit status. */
export function main(
  argv: readonly string[],
  write: (text: string) => void,
): number {
  const [command, ...rest] = argv;
  if (command === 'list') {
    const [suite, shards, pinned, ...features] = rest;
    if (
      suite === undefined ||
      shards === undefined ||
      pinned === undefined ||
      features.length === 0
    ) {
      throw new Error(
        'usage: list <suite> <shards> <pinned VS Code version> <feature>...',
      );
    }
    const cases = features.flatMap(feature => readCases(suite, feature));
    const names = replayable(cases);
    checkVscodePin(cases, names, pinned);
    write(
      `${JSON.stringify({shards: shard(names, Number(shards)), count: names.length})}\n`,
    );
    return 0;
  }
  if (command === 'merge' && rest[0] !== undefined) {
    const merged = mergeFolder(rest[0]);
    write(`${markdown(merged)}\n`);
    return merged.passed ? 0 : 1;
  }
  throw new Error('usage: conformance-shards.ts list|merge ...');
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), text =>
    process.stdout.write(text),
  );
}
