/**
 * @fileoverview coverage: measures line, branch and function coverage per unit with c8 and enforces the gates and
 * the ratchet of ADR-0003.
 *
 *     node tools/coverage.ts            check every unit
 *     node tools/coverage.ts --update   check, then record the new numbers in each unit's coverage.json
 *
 * A unit is tools/, or a package under packages/ that has a src/ folder. Its coverage.json holds the files excluded
 * from measurement, each with a reason, and the ratchet: the best numbers recorded so far.
 */

import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
  resolveBinary,
} from './repository.ts';

/** The three numbers the gates and the ratchet apply to, in percent. */
export interface CoverageNumbers {
  lines: number;
  branches: number;
  functions: number;
}

/** A unit's coverage.json: excluded files (relative to the unit) with their reasons, and the ratchet. */
export interface CoverageConfiguration {
  exclude?: Record<string, unknown>;
  ratchet?: CoverageNumbers;
}

/** A unit of measurement: tools/ or one package. */
export interface CoverageUnit {
  name: string;
  directory: string;
  sources: string;
  tests: string[];
  readme?: string;
}

/** The minimum numbers of ADR-0003, per unit. */
const COVERAGE_GATES: CoverageNumbers = {
  lines: 90,
  branches: 85,
  functions: 90,
};

/** How far a number may fall below its ratchet record before the check fails, in percentage points. */
const RATCHET_TOLERANCE = 0.5;

const METRICS = ['lines', 'branches', 'functions'] as const;

/** The units under `root`: tools/, then each package that has a src/ folder. */
export function coverageUnits(root: string): CoverageUnit[] {
  const packages = packageFolders(root)
    .filter(folder => existsSync(path.join(root, 'packages', folder, 'src')))
    .map(folder => ({
      name: folder,
      directory: path.join(root, 'packages', folder),
      sources: `packages/${folder}/src/**/*.ts`,
      tests: ['unit', 'integration']
        .filter(kind =>
          existsSync(path.join(root, 'packages', folder, 'test', kind)),
        )
        .map(kind => `packages/${folder}/test/${kind}/**/*.test.ts`),
      readme: path.join(root, 'packages', folder, 'README.md'),
    }));
  return [
    {
      name: 'tools',
      directory: path.join(root, 'tools'),
      sources: 'tools/**/*.ts',
      tests: ['tools/**/*.test.ts'],
    },
    ...packages,
  ];
}

/**
 * The problems with a unit's exclusions: an exclusion without a reason, one naming a file that no longer exists,
 * and, for a package, one its README does not list.
 */
export function exclusionProblems(
  unit: CoverageUnit,
  configuration: CoverageConfiguration,
): string[] {
  const problems: string[] = [];
  const readme =
    unit.readme !== undefined && existsSync(unit.readme)
      ? readFileSync(unit.readme, 'utf8')
      : undefined;
  for (const [file, reason] of Object.entries(configuration.exclude ?? {})) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push(`${unit.name}: exclusion ${file} has no reason`);
    }
    if (!existsSync(path.join(unit.directory, file))) {
      problems.push(`${unit.name}: exclusion ${file} names no file`);
    }
    if (unit.readme !== undefined && !(readme ?? '').includes(file)) {
      problems.push(
        `${unit.name}: exclusion ${file} is not listed in README.md`,
      );
    }
  }
  return problems;
}

/** The problems of measured numbers against the gates and against the ratchet record, if there is one. */
export function gateProblems(
  unitName: string,
  measured: CoverageNumbers,
  ratchet: CoverageNumbers | undefined,
): string[] {
  const problems: string[] = [];
  for (const metric of METRICS) {
    if (measured[metric] < COVERAGE_GATES[metric]) {
      problems.push(
        `${unitName}: ${metric} ${String(measured[metric])} % is below the gate of ${String(COVERAGE_GATES[metric])} %`,
      );
    }
    if (
      ratchet !== undefined &&
      measured[metric] < ratchet[metric] - RATCHET_TOLERANCE
    ) {
      problems.push(
        `${unitName}: ${metric} ${String(measured[metric])} % dropped more than ${String(RATCHET_TOLERANCE)} points below the record of ${String(ratchet[metric])} %`,
      );
    }
  }
  return problems;
}

/** The new ratchet: for each number the larger of record and measurement, so that small drops cannot creep. */
export function nextRatchet(
  ratchet: CoverageNumbers | undefined,
  measured: CoverageNumbers,
): CoverageNumbers {
  return {
    lines: Math.max(ratchet?.lines ?? 0, measured.lines),
    branches: Math.max(ratchet?.branches ?? 0, measured.branches),
    functions: Math.max(ratchet?.functions ?? 0, measured.functions),
  };
}

/** Runs the unit's tests under c8 from `root` and returns the measured numbers, or undefined when the tests fail. */
export function measureUnit(
  root: string,
  unit: CoverageUnit,
  excluded: string[],
): CoverageNumbers | undefined {
  const reports = mkdtempSync(path.join(tmpdir(), 'coverage-'));
  try {
    const relativeDirectory = path.relative(root, unit.directory);
    const exclusions = [
      '**/*.test.ts',
      '**/fixtures/**',
      '**/.tsc/**',
      ...excluded.map(file => path.join(relativeDirectory, file)),
    ].flatMap(pattern => ['--exclude', pattern]);
    const result = spawnSync(
      process.execPath,
      [
        resolveBinary('c8/bin/c8.js'),
        '--all',
        '--extension=.ts',
        `--include=${unit.sources}`,
        ...exclusions,
        '--reporter=json-summary',
        '--reporter=text-summary',
        `--reports-dir=${reports}`,
        `--temp-directory=${path.join(reports, 'raw')}`,
        process.execPath,
        resolveBinary('mocha/bin/mocha.js'),
        '--no-config',
        '--extension=ts',
        ...unit.tests,
      ],
      {cwd: root, stdio: ['ignore', 'inherit', 'inherit']},
    );
    if (result.status !== 0) {
      return undefined;
    }
    // c8's json-summary report has this shape for its `total` entry.
    const summary = JSON.parse(
      readFileSync(path.join(reports, 'coverage-summary.json'), 'utf8'),
    ) as {total: Record<(typeof METRICS)[number], {pct: number}>};
    return {
      lines: summary.total.lines.pct,
      branches: summary.total.branches.pct,
      functions: summary.total.functions.pct,
    };
  } finally {
    rmSync(reports, {recursive: true, force: true});
  }
}

function readConfiguration(unit: CoverageUnit): CoverageConfiguration {
  const file = path.join(unit.directory, 'coverage.json');
  // coverage.json is an object of this shape; its fields are checked where they are used.
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as CoverageConfiguration)
    : {};
}

/**
 * Checks every unit under `root` and, with `update`, records the new ratchet of each unit that passes. Returns the
 * problems found; an empty list means every unit passes.
 */
export function runCoverage(
  root: string,
  update: boolean,
  measure: typeof measureUnit = measureUnit,
): string[] {
  const problems: string[] = [];
  for (const unit of coverageUnits(root)) {
    const configuration = readConfiguration(unit);
    const unitProblems = exclusionProblems(unit, configuration);
    if (configuration.ratchet === undefined && !update) {
      unitProblems.push(
        `${unit.name}: coverage.json has no ratchet; run pnpm coverage:update`,
      );
    }
    const measured = measure(
      root,
      unit,
      Object.keys(configuration.exclude ?? {}),
    );
    if (measured === undefined) {
      unitProblems.push(`${unit.name}: the tests failed or none were found`);
    } else {
      unitProblems.push(
        ...gateProblems(unit.name, measured, configuration.ratchet),
      );
      if (update && unitProblems.length === 0) {
        const recorded = {
          ...configuration,
          ratchet: nextRatchet(configuration.ratchet, measured),
        };
        writeFileSync(
          path.join(unit.directory, 'coverage.json'),
          `${JSON.stringify(recorded, null, 2)}\n`,
        );
      }
    }
    problems.push(...unitProblems);
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  try {
    const problems = runCoverage(
      REPOSITORY_ROOT,
      process.argv.includes('--update'),
    );
    for (const problem of problems) {
      console.error(`coverage: ${problem}`);
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`coverage: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
