import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import type {Interpreter} from 'lib-host';
import {
  type BootstrapRequest,
  outcomesFor,
  STEP_OUTCOMES,
  type StepOutcome,
} from '../../src/scripts/steps.ts';

const GOLDEN_FOLDER = path.join(import.meta.dirname, 'golden');

/** The varying part of a fact key, as the declarations write it. */
function normalized(key: string): string {
  return key
    .replace(/\$POSITION|\$Position/g, '<n>')
    .replace(/\$TOOL|\$Tool/g, '<tool>')
    .replace(/\$REQUIREMENTS_LINE/g, '<line>');
}

/** The statuses and fact keys a rendered script can end with, as its text names them. */
function reported(
  text: string,
  interpreter: Interpreter,
): {statuses: Set<string>; facts: Set<string>} {
  if (interpreter === 'posixShell') {
    return {
      statuses: new Set(
        [...text.matchAll(/\b(?:finish|leave)\s+([A-Z][A-Za-z]+)\b/g)].map(
          found => found[1] ?? '',
        ),
      ),
      facts: new Set(
        [...text.matchAll(/\bfact\s+"?([a-z][A-Za-z0-9.$_]*)"?/g)].map(found =>
          normalized(found[1] ?? ''),
        ),
      ),
    };
  }
  return {
    statuses: new Set(
      [...text.matchAll(/\b(?:Complete-Step|Exit-Step)\s+'([A-Za-z]+)'/g)].map(
        found => found[1] ?? '',
      ),
    ),
    facts: new Set(
      [...text.matchAll(/Add-Fact\s+(?:'([^']+)'|\(([^)]*)\))/g)].map(found =>
        normalized(
          found[1] ??
            (found[2] ?? '').replaceAll("'", '').replace(/\s*\+\s*/g, ''),
        ),
      ),
    ),
  };
}

/** Each golden script: its interpreter, its step and its text. */
function goldenScripts(): Array<{
  file: string;
  interpreter: Interpreter;
  step: BootstrapRequest['step'];
  text: string;
}> {
  return (
    [
      ['posix', 'posixShell'],
      ['powershell', 'powershell'],
    ] as const
  ).flatMap(([folder, interpreter]) =>
    readdirSync(path.join(GOLDEN_FOLDER, folder)).map(file => ({
      file: `${folder}/${file}`,
      interpreter,
      step: file
        .replace(/^(base|full)-(stepwise-)?/, '')
        .replace(/\.(sh|ps1)$/, '') as BootstrapRequest['step'],
      text: readFileSync(path.join(GOLDEN_FOLDER, folder, file), 'utf8'),
    })),
  );
}

/** The keys of declared outcomes, whichever interpreter reports them. */
function keysOf(outcomes: ReadonlyArray<StepOutcome<string>>): string[] {
  return outcomes.map(outcome =>
    typeof outcome === 'string' ? outcome : outcome.key,
  );
}

/** What `values` holds that `allowed` lacks, sorted. */
function beyond(
  values: Iterable<string>,
  allowed: readonly string[],
): string[] {
  return [...values].filter(value => !allowed.includes(value)).sort();
}

describe('the outcomes each step declares', () => {
  for (const script of goldenScripts()) {
    it(`ADR-0013: ${script.file} reports only what its step declares for its interpreter`, () => {
      const outcomes = STEP_OUTCOMES[script.step];
      const found = reported(script.text, script.interpreter);
      deepStrictEqual(
        {
          statuses: beyond(
            found.statuses,
            outcomesFor(outcomes.statuses, script.interpreter),
          ),
          facts: beyond(
            found.facts,
            outcomesFor(outcomes.facts, script.interpreter),
          ),
        },
        {statuses: [], facts: []},
      );
    });
  }

  it('ADR-0013: every declared status and fact key is reported by some script of its step', () => {
    const scripts = goldenScripts();
    const unreported = Object.entries(STEP_OUTCOMES).flatMap(
      ([step, outcomes]) => {
        const found = scripts
          .filter(script => script.step === step)
          .map(script => reported(script.text, script.interpreter));
        return [
          ...keysOf(outcomes.statuses).filter(
            key => !found.some(each => each.statuses.has(key)),
          ),
          ...keysOf(outcomes.facts).filter(
            key => !found.some(each => each.facts.has(key)),
          ),
        ].map(key => `${step}: ${key}`);
      },
    );
    deepStrictEqual(unreported, []);
  });

  describe('outcomesFor', () => {
    it('keeps a shared outcome and one only this interpreter reports, and drops the other', () => {
      deepStrictEqual(
        outcomesFor(
          [
            'Ok',
            {key: 'LinuxPrereqs', only: 'posixShell'},
            {key: 'ServerFailedToStart', only: 'powershell'},
          ],
          'powershell',
        ),
        ['Ok', 'ServerFailedToStart'],
      );
    });
  });
});
