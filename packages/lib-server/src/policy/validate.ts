import type {PolicyProblem, ServerPolicyRecord} from './record.ts';

/** The record's fields in declaration order, so problems come out in field order. */
const FIELD_NAMES: string[] = [
  'downloadPlacement',
  'cache',
  'verification',
  'environmentSetup',
  'requirementsCheck',
  'allowedExtraStartOptions',
  'extensionEntries',
  'installUmask',
  'cleanup',
  'installMode',
  'prefetch',
];

const KNOWN_PLACEMENT_KINDS = new Set<string>([
  'hostFirst',
  'clientFirstThenHost',
  'clientOnly',
]);

const KNOWN_PLACEMENT_MODES = new Set<string>(['auto', 'always', 'off']);

const KNOWN_EXTRA_START_OPTIONS = new Set<string>([
  'fileWatcherPolling',
  'useHostProxy',
  'forceDisableUserEnv',
]);

const KNOWN_EXTENSION_ENTRIES = new Set<string>([
  'identifiersOnly',
  'asWritten',
]);

const KNOWN_INSTALL_UMASKS = new Set<string>(['inherit', '022']);

const KNOWN_VERIFICATIONS = new Set<string>([
  'headerHash',
  'lengthOnly',
  'none',
]);

/** A positive whole number, the shape of every count the record carries. */
function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/**
 * Check a candidate record and report every problem it has, each at the JSON-path-like position
 * of the bad value. A candidate with no problems is returned unchanged. A candidate missing a
 * required field other than `cache` is a caller error and raises, because the record's shape is
 * fixed by the type; the table of problems covers value problems, unknown fields, and `cache`.
 */
export function validatePolicyRecord(
  candidate: unknown,
): {record: ServerPolicyRecord} | {problems: PolicyProblem[]} {
  if (typeof candidate !== 'object' || candidate === null) {
    return {problems: [{path: '', problem: 'not an object'}]};
  }
  // Value checks read the record as data, not through its declared types, so any wrong value is
  // seen. Unknown-field detection uses the same view.
  const partial = candidate as Partial<ServerPolicyRecord>;
  // The remaining fields are required by the record's type, so the data view reads them directly.
  const asData = candidate as {
    downloadPlacement: {kind: string; mode: string};
    verification: readonly string[];
    allowedExtraStartOptions: readonly string[];
    extensionEntries: string;
    installUmask: string;
    cleanup: {kind: string; count: number};
    prefetch: {
      kind: string;
      feedCheckIntervalMilliseconds: number;
      platformWindowDays: number;
      licence: string;
    };
    [field: string]: unknown;
  };
  const problems: PolicyProblem[] = [];
  function problem(path: string, text: string): void {
    problems.push({path, problem: text});
  }
  for (const name of Object.keys(asData)) {
    if (!FIELD_NAMES.includes(name)) {
      problem(name, 'unknown field');
    }
  }
  if (partial.cache === undefined) {
    problem('cache', 'missing');
  }
  const placement = asData.downloadPlacement;
  if (!KNOWN_PLACEMENT_KINDS.has(placement.kind)) {
    problem('downloadPlacement.kind', 'invalid value');
  } else if (
    placement.kind === 'hostFirst' &&
    !KNOWN_PLACEMENT_MODES.has(placement.mode)
  ) {
    problem('downloadPlacement.mode', 'invalid value');
  }
  const verification = asData.verification;
  if (verification.length === 0) {
    problem('verification', 'empty');
  } else {
    const seen = new Set<string>();
    verification.forEach((entry, index) => {
      if (!KNOWN_VERIFICATIONS.has(entry)) {
        problem(`verification[${String(index)}]`, 'invalid value');
      } else if (seen.has(entry)) {
        problem(`verification[${String(index)}]`, 'duplicate');
      } else {
        seen.add(entry);
      }
    });
  }
  if (partial.environmentSetup?.length === 0) {
    problem('environmentSetup', 'empty');
  }
  const cleanup = asData.cleanup;
  if (cleanup.kind === 'keepNewest' && !positiveInteger(cleanup.count)) {
    problem('cleanup.count', 'must be a positive integer');
  }
  asData.allowedExtraStartOptions.forEach((option, index) => {
    if (!KNOWN_EXTRA_START_OPTIONS.has(option)) {
      problem(`allowedExtraStartOptions[${String(index)}]`, 'invalid value');
    }
  });
  if (!KNOWN_EXTENSION_ENTRIES.has(asData.extensionEntries)) {
    problem('extensionEntries', 'invalid value');
  }
  if (!KNOWN_INSTALL_UMASKS.has(asData.installUmask)) {
    problem('installUmask', 'invalid value');
  }
  const prefetch = asData.prefetch;
  if (prefetch.kind === 'onProductUpdate') {
    if (!positiveInteger(prefetch.feedCheckIntervalMilliseconds)) {
      problem(
        'prefetch.feedCheckIntervalMilliseconds',
        'must be a positive integer',
      );
    }
    if (!positiveInteger(prefetch.platformWindowDays)) {
      problem('prefetch.platformWindowDays', 'must be a positive integer');
    }
    if (prefetch.licence !== 'skipUnaccepted') {
      problem('prefetch.licence', 'invalid value');
    }
  }
  if (problems.length > 0) {
    return {problems};
  }
  return {record: candidate as ServerPolicyRecord};
}
