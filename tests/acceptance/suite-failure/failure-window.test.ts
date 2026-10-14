import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  launchScript,
  type RecordLine,
  type ScriptEntry,
} from '../suite-local/script.ts';
import {connectionLog} from '../suite/harness.ts';
import {requestsOfLaunch} from '../suite-install/install.ts';
import casesFile from './cases.json' with {type: 'json'};

/** One failing connect of the run, as tests/acceptance/suite-failure/cases.json lists it. */
interface FailureCase {
  label?: string;
  alias: string;
  /** The criteria the case's dialog text proves. */
  cite: string;
  script: ScriptEntry[];
  dialog: string;
  /** Settings merged over the run's base settings for the case's launch. */
  settings?: Record<string, unknown>;
  /** The bound the dialog's time is checked against. */
  bound?: {from: string; milliseconds: number; cite: string};
  /** A text the connection log holds in a line. */
  logIncludes?: string;
  /** Whether the download host must have seen no request while the case ran. */
  noDownloadRequests?: boolean;
}

/** The failing connects, bundled from the file the harness reads to launch them. */
const cases = (casesFile as {cases: FailureCase[]}).cases;

/** The name of a failing connect: its label, or its alias without one. */
function nameOf(failure: FailureCase): string {
  return failure.label ?? failure.alias;
}

/** The failing connect of this window, named by the variable the harness gave it. */
const failure = cases.find(
  candidate => nameOf(candidate) === process.env.HARNESS_FAILURE_CASE,
);

/** The record of this window's script once the pick of actions was answered, waiting up to 90 s. */
async function recordAfterDialog(): Promise<RecordLine[]> {
  const launched = launchScript();
  for (let attempt = 0; attempt < 180; attempt++) {
    const record = launched.record();
    if (record.some(line => line.surface === 'mitigationPick')) {
      return record;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return launched.record();
}

describe(`a failed connect to "${failure?.alias ?? 'unknown'}" (ruling 1)`, () => {
  let lines: RecordLine[] = [];
  let record: RecordLine[] = [];

  before(async () => {
    lines = await recordAfterDialog();
    record = lines.filter(
      line => !['progress', 'downloadProgress'].includes(line.surface),
    );
  });

  it('contracts harness: the window is one of the failing connects', () => {
    strictEqual(failure === undefined, false);
  });

  it(`${failure?.cite ?? 'F-2601'}: the dialog names the alias, with the reason of the failure`, () => {
    strictEqual(
      record.find(line => line.surface === 'failureDialog')?.question,
      failure?.dialog,
    );
  });

  it('F-2601 AC-12, AC-13, AC-31: dismissing the dialog opened the pick of actions, and every question was the next one of the script (ruling 5)', () => {
    deepStrictEqual(
      record.map(line => [line.surface, line.matched]),
      failure?.script.map(entry => [entry.surface, true]),
    );
  });

  it('F-2601 AC-2: the dialog has exactly Close Remote, Retry and More Actions..., in that order', () => {
    deepStrictEqual(
      record.find(line => line.surface === 'failureDialog')?.buttons,
      ['Close Remote', 'Retry', 'More Actions...'],
    );
  });

  if (failure?.bound !== undefined) {
    const bound = failure.bound;
    it(`${bound.cite}: the dialog came within ${String(bound.milliseconds)} ms of the ${bound.from}`, () => {
      const dialog = lines.find(line => line.surface === 'failureDialog');
      const from = lines.find(line => line.surface === bound.from);
      const gapMs =
        dialog === undefined || from === undefined
          ? Number.POSITIVE_INFINITY
          : dialog.time - from.time;
      strictEqual(gapMs <= bound.milliseconds, true);
    });
  }

  if (failure?.logIncludes !== undefined) {
    const wanted = failure.logIncludes;
    it(`${failure.cite}: the log has a line with "${wanted}"`, () => {
      strictEqual(
        connectionLog().some(line => line.includes(wanted)),
        true,
      );
    });
  }

  if (failure?.noDownloadRequests === true) {
    it(`${failure.cite}: the download host saw no request`, () => {
      deepStrictEqual(requestsOfLaunch(`failure-${nameOf(failure)}`), []);
    });
  }

  if (failure !== undefined && nameOf(failure) === 'stranger') {
    it('F-2304 AC-14: the dialog of a dismissed host-key pick never says "Connecting was canceled"', () => {
      const dialog = record.find(line => line.surface === 'failureDialog');
      strictEqual(
        dialog === undefined ||
          dialog.question.includes('Connecting was canceled'),
        false,
      );
    });
  }

  it('F-2601 AC-14: once the pick of actions is dismissed, nothing more is asked', async () => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    deepStrictEqual(launchScript().record().at(-1), lines.at(-1));
  });
});
