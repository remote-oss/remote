import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import {hostPlatformLine} from '../../../packages/remote-ssh/src/diagnostics/log-content.ts';
import {type RecordLine} from '../suite-local/script.ts';
import {connectionLog, recordLines} from '../suite/harness.ts';
import casesFile from './cases.json' with {type: 'json'};

/** What the settings file holds of `remote.SSH.remotePlatform` afterwards: the case's expectation. */
type After = 'absent' | 'unchanged' | 'bytes' | Record<string, string>;

/** One platform case of the run, as tests/acceptance/suite-platform/cases.json lists it. */
interface PlatformCase {
  label: string;
  /** The criteria the case proves, with its label in parentheses. */
  cite: string;
  authority?: string;
  settings: Record<string, unknown>;
  /** Whether the platform pick is asked, and the placeholder it has when the table gives one. */
  asked: boolean;
  placeholder?: string;
  /** How the connect ends: connected, or a dialog; a dialog's text is absent when any text counts. */
  outcome: 'connected' | 'dialog';
  dialog?: string;
  after: After;
}

/** The platform case of this window, named by the variable the harness gave it. */
const platformCase = (casesFile as {cases: PlatformCase[]}).cases.find(
  candidate => candidate.label === (process.env.HARNESS_PLATFORM_CASE ?? ''),
);

/** The run's folder, where the launch's settings live. */
const runFolder = process.env.HARNESS_RUN_FOLDER ?? '';

/** The launch's label: the case's with the suite's prefix, as the cites name it. */
const label = `platform-${platformCase?.label ?? 'unknown'}`;
const ac31 = `F-2206 AC-31 (${label})`;
const cite = platformCase?.cite ?? 'F-2206';

/** The lines `Detected Windows host, need to reconnect` (S034) and the fixed part of S057 would be in. */
const WINDOWS_TEXTS = [
  'Detected Windows host, need to reconnect',
  'setting correctly reflects the remote platform',
];

/** The start of connect-28's platform line, as the builder writes it before the values. */
const PLATFORM_LINE_START =
  hostPlatformLine({operatingSystem: 'linux', architecture: 'x64'}).split(
    'linux',
  )[0] ?? '';

/** The settings file of this window's launch. */
const settingsFile = path.join(
  process.env.HARNESS_USER_DATA ?? '',
  'User',
  'settings.json',
);

/** The launch's copy of the settings it was given. */
const givenFile = path.join(runFolder, `${label}-settings.json`);

/** The members of the file's `remote.SSH.remotePlatform` as the editor wrote it, in order; undefined when it has none. */
function platformEntries(text: string): Array<[string, string]> | undefined {
  const parsed = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')) as Record<
    string,
    unknown
  >;
  const value = parsed['remote.SSH.remotePlatform'];
  return value === undefined
    ? undefined
    : Object.entries(value as Record<string, string>);
}

/** The record once the case's window has finished with its questions, waiting up to 90 s for the last one. */
async function recordAfterConnect(): Promise<RecordLine[]> {
  const last =
    platformCase?.outcome === 'dialog' ? 'mitigationPick' : undefined;
  for (let attempt = 0; attempt < 180; attempt++) {
    const record = recordLines();
    if (last === undefined || record.some(line => line.surface === last)) {
      return record;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return recordLines();
}

describe(`the platform case "${label}" of the VSCodium run`, () => {
  let lines: RecordLine[] = [];
  let record: RecordLine[] = [];

  before(async () => {
    lines = await recordAfterConnect();
    record = lines.filter(
      line =>
        !['progress', 'downloadProgress', 'progressEnd'].includes(line.surface),
    );
  });

  it('contracts harness: the window is one of the platform cases', () => {
    strictEqual(platformCase === undefined, false);
  });

  it(`${cite}: the platform pick was asked or not, as the case says`, () => {
    const asked = record.filter(line => line.surface === 'platformPick');
    deepStrictEqual(
      [
        asked.length > 0,
        platformCase?.placeholder === undefined
          ? undefined
          : asked[0]?.question,
      ],
      [platformCase?.asked, platformCase?.placeholder],
    );
  });

  it(`${cite}: the connect ended as the case says`, () => {
    const dialog = record.find(line => line.surface === 'failureDialog');
    const ended =
      dialog === undefined
        ? vscode.env.remoteName === 'ssh-remote'
          ? 'connected'
          : 'nothing'
        : platformCase?.dialog === undefined
          ? 'a dialog'
          : dialog.question;
    deepStrictEqual(
      ended,
      platformCase?.outcome === 'connected'
        ? 'connected'
        : (platformCase?.dialog ?? 'a dialog'),
    );
  });

  it(`${cite}: remote.SSH.remotePlatform afterwards is the case's`, async () => {
    const expected = platformCase?.after;
    const wanted =
      expected === 'absent' || expected === 'bytes'
        ? undefined
        : Object.entries(
            expected === 'unchanged'
              ? (platformCase?.settings['remote.SSH.remotePlatform'] as Record<
                  string,
                  string
                >)
              : (expected ?? {}),
          );
    let found =
      expected === 'bytes'
        ? undefined
        : platformEntries(readFileSync(settingsFile, 'utf8'));
    // The editor writes the setting while the connect goes on: wait for it up to 10 s.
    for (let attempt = 0; attempt < 40 && expected !== 'bytes'; attempt++) {
      if (JSON.stringify(found) === JSON.stringify(wanted)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      found = platformEntries(readFileSync(settingsFile, 'utf8'));
    }
    deepStrictEqual(
      expected === 'bytes' ? readFileSync(settingsFile, 'utf8') : found,
      expected === 'bytes' ? readFileSync(givenFile, 'utf8') : wanted,
    );
  });

  if (label === 'platform-pick-linux') {
    it('F-2206 AC-2 (platform-pick-linux): the pick lists Linux, Windows and macOS, in order', () => {
      deepStrictEqual(
        record.find(line => line.surface === 'platformPick')?.items,
        ['Linux', 'Windows', 'macOS'],
      );
    });

    it('F-2206 AC-2 (platform-pick-linux): Linux is focused', () => {
      strictEqual(
        record.find(line => line.surface === 'platformPick')?.active,
        'Linux',
      );
    });
  }

  if (
    [
      'platform-default',
      'platform-macos-default',
      'platform-wrong-case-upper',
      'platform-wrong-case-title',
    ].includes(label)
  ) {
    it(`${cite}: no notice appeared`, () => {
      deepStrictEqual(
        record.filter(line => line.surface === 'notice'),
        [],
      );
    });
  }

  if (label === 'platform-default') {
    it("positive control: the probe's lines are in the log of a default-mode connect", () => {
      strictEqual(
        connectionLog().some(line => line.startsWith(PLATFORM_LINE_START)),
        true,
      );
    });
  }

  if (label === 'platform-windows-default') {
    it('F-2206 AC-11 (platform-windows-default): no probe ran', () => {
      strictEqual(
        connectionLog().some(line => line.startsWith(PLATFORM_LINE_START)),
        false,
      );
    });
  }

  if (label === 'platform-wildcard-windows') {
    it('F-2206 AC-32 (platform-wildcard-windows): More Actions... offers the resolve picker', () => {
      strictEqual(
        record.find(line => line.surface === 'mitigationPick')?.question,
        'Pick an action to help resolve the problem.',
      );
    });
  }

  if (
    platformCase?.outcome === 'dialog' ||
    [
      'platform-exact-macos',
      'platform-macos-default',
      'platform-pick-macos',
    ].includes(label)
  ) {
    it(`${ac31}: no line names a detected Windows host or the remotePlatform hint`, () => {
      deepStrictEqual(
        record.filter(line =>
          WINDOWS_TEXTS.some(text =>
            [line.question, ...(line.items ?? [])].some(shown =>
              shown.includes(text),
            ),
          ),
        ),
        [],
      );
    });
  }

  if (label === 'platform-broken-settings') {
    it('F-2206 AC-36 (platform-broken-settings): no error notification appears', () => {
      deepStrictEqual(
        record
          .filter(
            line =>
              line.surface === 'notice' &&
              !line.question.startsWith('You selected'),
          )
          .map(line => line.question),
        [],
      );
    });
  }

  if (label === 'platform-mute-default') {
    it('F-2206 AC-28 (platform-mute-default): no pick, and the dialog came after the host connect timeout', () => {
      const dialog = lines.find(line => line.surface === 'failureDialog');
      const first = lines.find(line => line.surface === 'progress');
      const elapsed =
        dialog === undefined || first === undefined
          ? Number.NaN
          : dialog.time - first.time;
      deepStrictEqual(
        [
          lines.some(line => line.surface === 'platformPick'),
          elapsed >= 10_000 && elapsed <= 15_000,
        ],
        [false, true],
      );
    });
  }
});
