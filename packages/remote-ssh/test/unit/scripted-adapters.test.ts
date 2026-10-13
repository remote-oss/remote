import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {licenceModalOf} from '../../src/surfaces/licence-modal.ts';
import type {EditorAdapters} from '../../src/editor-surfaces.ts';
import type {ProgressPort, ProgressRequest} from 'lib-authority';
import type {ChannelPort, RevealableChannel} from '../../src/log-channel.ts';
import {
  adaptersFor,
  channelPortFor,
  progressFor,
  type RecordLine,
  type ScriptEntry,
  scriptedAdapters,
  windowNameOf,
} from '../../src/surfaces/scripted-adapters.ts';

const SCRIPT_FILE = '/run/script.json';
const RECORD_FILE = '/run/record.jsonl';
const NEVER = new AbortController().signal;
const WINDOW = 'main';

/** The lines of a record without their append times. */
function withoutTime(
  lines: Array<Omit<RecordLine, 'time'> & {time?: number}>,
): Array<Omit<RecordLine, 'time'>> {
  return lines.map(line => {
    delete line.time;
    return line;
  });
}

/** In-memory files: the script as written, and every text appended to the record. */
class MemoryFiles {
  readonly appended: string[] = [];

  readonly contents: Map<string, string>;

  constructor(contents = new Map<string, string>()) {
    this.contents = contents;
  }

  readonly read = (file: string): string => {
    const text = this.contents.get(file);
    if (text === undefined) {
      throw new Error(`no such file: ${file}`);
    }
    return text;
  };

  readonly append = (file: string, text: string): void => {
    deepStrictEqual(file, RECORD_FILE);
    this.appended.push(text);
  };

  /** The record as parsed lines, without their append times. */
  lines(): Array<Omit<RecordLine, 'time'>> {
    return withoutTime(
      this.appended
        .join('')
        .split('\n')
        .filter(line => line !== '')
        .map(
          line =>
            JSON.parse(line) as Omit<RecordLine, 'time'> & {time?: number},
        ),
    );
  }
}

/** Files holding a script of `entries`. */
function filesWith(entries: ScriptEntry[]): MemoryFiles {
  return new MemoryFiles(new Map([[SCRIPT_FILE, JSON.stringify({entries})]]));
}

const REAL: EditorAdapters = {
  prompts: {
    pick: () => Promise.resolve('no'),
    maskedInput: () => Promise.resolve('real'),
    translate: template => template,
  },
  terminals: new RecordingTerminals(),
  failureDialog: {showError: () => Promise.resolve('real')},
  licenceDialog: {showModal: () => Promise.resolve('real')},
  platformPick: {pick: () => Promise.resolve('linux')},
  mitigationPick: {pick: () => Promise.resolve('reloadWindow')},
  downloadProgress: {
    show: () => ({report: () => undefined, close: () => undefined}),
  },
  textInput: {showInputBox: () => Promise.resolve('real')},
  notice: {
    showInformation: () => Promise.resolve('real'),
    showWarning: () => Promise.resolve('real'),
    showError: () => Promise.resolve('real'),
  },
};

/** The scripted adapters over `entries`, with the files they wrote to. */
function scripted(entries: ScriptEntry[], windowName = WINDOW) {
  const files = filesWith(entries);
  const adapters = scriptedAdapters(
    SCRIPT_FILE,
    RECORD_FILE,
    REAL,
    files,
    windowName,
  );
  return {adapters, files};
}

const FINGERPRINT = {
  title: 'The authenticity of host dev can not be established.',
  placeholder: 'Are you sure?',
  items: [
    {label: 'Yes', answer: 'yes' as const},
    {label: 'No', answer: 'no' as const},
  ],
};

const ENABLED = {
  REMOTE_OSS_ACCEPTANCE: '1',
  REMOTE_OSS_ACCEPTANCE_SCRIPT: SCRIPT_FILE,
  REMOTE_OSS_ACCEPTANCE_RECORD: RECORD_FILE,
};

const PLATFORM_PICK = {
  placeholder: {id: 'platformPickPlaceholder', values: ['dev']},
  items: [{label: 'Linux', platform: 'linux' as const}],
};

const MITIGATION_PICK = {
  placeholder: 'More actions',
  items: [{label: 'Reload', action: 'reloadWindow' as const}],
};

/** The files of a folder, recursively, as paths. */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory()
      ? filesUnder(path.join(folder, entry.name))
      : [path.join(folder, entry.name)],
  );
}

const PACKAGE_FOLDER = path.join(import.meta.dirname, '..', '..');

describe('which adapters the extension uses', () => {
  const files = new MemoryFiles();

  it('constraint 7: with no switch it uses the real adapters', () => {
    strictEqual(adaptersFor({}, REAL, files, WINDOW), REAL);
  });

  it('constraint 7: with the switch at 0 it uses the real adapters', () => {
    strictEqual(
      adaptersFor(
        {...ENABLED, REMOTE_OSS_ACCEPTANCE: '0'},
        REAL,
        files,
        WINDOW,
      ),
      REAL,
    );
  });

  it('constraint 2: with the switch on and no script it uses the real adapters', () => {
    strictEqual(
      adaptersFor(
        {...ENABLED, REMOTE_OSS_ACCEPTANCE_SCRIPT: undefined},
        REAL,
        files,
        WINDOW,
      ),
      REAL,
    );
  });

  it('constraint 2: with the switch on and no record it uses the real adapters', () => {
    strictEqual(
      adaptersFor(
        {...ENABLED, REMOTE_OSS_ACCEPTANCE_RECORD: undefined},
        REAL,
        files,
        WINDOW,
      ),
      REAL,
    );
  });

  it('constraint 2: with the switch on and an empty script name it uses the real adapters', () => {
    strictEqual(
      adaptersFor(
        {...ENABLED, REMOTE_OSS_ACCEPTANCE_SCRIPT: ''},
        REAL,
        files,
        WINDOW,
      ),
      REAL,
    );
  });

  it('constraint 2: with the switch on and an empty record name it uses the real adapters', () => {
    strictEqual(
      adaptersFor(
        {...ENABLED, REMOTE_OSS_ACCEPTANCE_RECORD: ''},
        REAL,
        files,
        WINDOW,
      ),
      REAL,
    );
  });

  it('constraint 1: with the switch on and both files it uses adapters that are not the real ones', () => {
    strictEqual(
      adaptersFor(ENABLED, REAL, filesWith([]), WINDOW) === REAL,
      false,
    );
  });

  it('constraint 1, ruling 4: no source file but the adapters names the variables', () => {
    deepStrictEqual(
      filesUnder(path.join(PACKAGE_FOLDER, 'src')).filter(
        file =>
          !file.endsWith('scripted-adapters.ts') &&
          readFileSync(file, 'utf8').includes('REMOTE_OSS_ACCEPTANCE'),
      ),
      [],
    );
  });

  it('constraint 1: no string file of the package names the switch', () => {
    deepStrictEqual(
      [
        ...readdirSync(PACKAGE_FOLDER)
          .filter(name => /^package\.nls(\.[\w-]+)?\.json$/.test(name))
          .map(name => path.join(PACKAGE_FOLDER, name)),
        ...filesUnder(path.join(PACKAGE_FOLDER, 'l10n')),
      ].filter(file =>
        readFileSync(file, 'utf8').includes('REMOTE_OSS_ACCEPTANCE'),
      ),
      [],
    );
  });

  it('card tooling-24: with the switch off the text input and notice are the real ports', () => {
    const adapters = adaptersFor({}, REAL, files);
    deepStrictEqual(
      [adapters.textInput, adapters.notice],
      [REAL.textInput, REAL.notice],
    );
  });
});

describe('the scripted adapters answer from the script only', () => {
  it('constraint 2: with an empty script a host key pick is dismissed', async () => {
    deepStrictEqual(
      await scripted([]).adapters.prompts.pick(FINGERPRINT, NEVER),
      undefined,
    );
  });

  it('constraint 2: with an empty script the dismissal is recorded as not matched', async () => {
    const {adapters, files} = scripted([]);
    await adapters.prompts.pick(FINGERPRINT, NEVER);
    deepStrictEqual(files.lines(), [
      {
        surface: 'pick',
        question: FINGERPRINT.title,
        answer: 'dismiss',
        matched: false,
        window: WINDOW,
      },
    ]);
  });

  it('constraint 2: with an empty script a masked input is dismissed', async () => {
    deepStrictEqual(
      await scripted([]).adapters.prompts.maskedInput(
        {placeholder: "alex@dev's password:"},
        NEVER,
      ),
      undefined,
    );
  });

  it('constraint 2: with an empty script a failure dialog is dismissed', async () => {
    deepStrictEqual(
      await scripted([]).adapters.failureDialog.showError('Failed', ['Retry']),
      undefined,
    );
  });

  it('constraint 2: with an empty script a platform pick is dismissed', async () => {
    deepStrictEqual(
      await scripted([]).adapters.platformPick.pick(PLATFORM_PICK, NEVER),
      undefined,
    );
  });

  it('constraint 2: with an empty script the more actions pick is dismissed', async () => {
    deepStrictEqual(
      await scripted([]).adapters.mitigationPick.pick(MITIGATION_PICK),
      undefined,
    );
  });

  it('constraint 3: with an empty script the licence modal is dismissed', async () => {
    deepStrictEqual(
      await scripted([]).adapters.licenceDialog.showModal('m', 'd', [
        'Accept and Continue',
        'Cancel',
      ]),
      undefined,
    );
  });

  it('constraint 2: a script file that is missing is an empty script', async () => {
    deepStrictEqual(
      await scriptedAdapters(
        SCRIPT_FILE,
        RECORD_FILE,
        REAL,
        new MemoryFiles(),
        WINDOW,
      ).prompts.pick(FINGERPRINT, NEVER),
      undefined,
    );
  });

  it('constraint 2: a script file with no entries list is an empty script', async () => {
    const files = new MemoryFiles(new Map([[SCRIPT_FILE, '{"other": 1}']]));
    deepStrictEqual(
      await scriptedAdapters(
        SCRIPT_FILE,
        RECORD_FILE,
        REAL,
        files,
        WINDOW,
      ).prompts.pick(FINGERPRINT, NEVER),
      undefined,
    );
  });

  it('constraint 2: a script file that is not JSON is an empty script', async () => {
    const files = new MemoryFiles(new Map([[SCRIPT_FILE, 'not json']]));
    deepStrictEqual(
      await scriptedAdapters(
        SCRIPT_FILE,
        RECORD_FILE,
        REAL,
        files,
        WINDOW,
      ).prompts.pick(FINGERPRINT, NEVER),
      undefined,
    );
  });

  it('#253: a pick whose title holds the entry text gets the entry answer', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'pick', match: 'authenticity', answer: 'yes'},
      ]).adapters.prompts.pick(FINGERPRINT, NEVER),
      'yes',
    );
  });

  it('#253: a pick answered from the script is recorded as matched', async () => {
    const {adapters, files} = scripted([
      {surface: 'pick', match: 'authenticity', answer: 'no'},
    ]);
    await adapters.prompts.pick(FINGERPRINT, NEVER);
    deepStrictEqual(files.lines(), [
      {
        surface: 'pick',
        question: FINGERPRINT.title,
        answer: 'no',
        matched: true,
        window: WINDOW,
      },
    ]);
  });

  it('#253: a pick with no title is matched by its placeholder', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'pick', match: 'sure', answer: 'yes'},
      ]).adapters.prompts.pick(
        {placeholder: FINGERPRINT.placeholder, items: FINGERPRINT.items},
        NEVER,
      ),
      'yes',
    );
  });

  it('#253: a pick entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'pick', match: 'authenticity', answer: 'dismiss'},
      ]).adapters.prompts.pick(FINGERPRINT, NEVER),
      undefined,
    );
  });

  it('ruling 5: a question of another surface does not consume the next entry', async () => {
    const {adapters} = scripted([
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
    ]);
    await adapters.prompts.maskedInput({placeholder: 'password'}, NEVER);
    deepStrictEqual(await adapters.prompts.pick(FINGERPRINT, NEVER), 'yes');
  });

  it('ruling 5: an entry for another surface is not used by a question whose text matches it', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'pick', match: 'password', answer: 'yes'},
      ]).adapters.prompts.maskedInput({placeholder: 'password'}, NEVER),
      undefined,
    );
  });

  it('ruling 5: an entry for another surface stays unused when a question whose text matches it is asked', async () => {
    const {adapters} = scripted([
      {surface: 'pick', match: 'password', answer: 'yes'},
    ]);
    await adapters.prompts.maskedInput({placeholder: 'password'}, NEVER);
    strictEqual(adapters.unusedEntries(), 1);
  });

  it('ruling 5: the question of another surface itself is dismissed', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'pick', match: 'authenticity', answer: 'yes'},
      ]).adapters.prompts.maskedInput({placeholder: 'password'}, NEVER),
      undefined,
    );
  });

  it('ruling 5: a pick that does not match the entry is dismissed', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'pick', match: 'zzz', answer: 'yes'},
      ]).adapters.prompts.pick({...FINGERPRINT, title: 'abc'}, NEVER),
      undefined,
    );
  });

  it('ruling 5: a pick that does not match leaves its entry unused', async () => {
    const {adapters} = scripted([
      {surface: 'pick', match: 'zzz', answer: 'yes'},
    ]);
    await adapters.prompts.pick({...FINGERPRINT, title: 'abc'}, NEVER);
    strictEqual(adapters.unusedEntries(), 1);
  });

  it('ruling 5: an answered entry is not unused', async () => {
    const {adapters} = scripted([
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
    ]);
    await adapters.prompts.pick(FINGERPRINT, NEVER);
    strictEqual(adapters.unusedEntries(), 0);
  });

  it('constraint 3: the licence modal can only decline: it gives the last button', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'licenceModal', match: '', answer: 'decline'},
      ]).adapters.licenceDialog.showModal('m', 'd', [
        'Accept and Continue',
        'Cancel',
      ]),
      'Cancel',
    );
  });

  it('constraint 3: the modal of the extension reads a decline as a cancel, never as an acceptance', async () => {
    deepStrictEqual(
      await licenceModalOf(
        scripted([{surface: 'licenceModal', match: '', answer: 'decline'}])
          .adapters.licenceDialog,
        template => template,
        {applicationName: 'Editor', displayName: 'Remote'},
      ).askUser('https://example.invalid/terms', NEVER),
      'cancel',
    );
  });

  it('constraint 3: a licence modal entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'licenceModal', match: '', answer: 'dismiss'},
      ]).adapters.licenceDialog.showModal('m', 'd', ['Accept', 'Cancel']),
      undefined,
    );
  });

  it('constraint 3: a decline with no buttons gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'licenceModal', match: '', answer: 'decline'},
      ]).adapters.licenceDialog.showModal('m', 'd', []),
      undefined,
    );
  });

  it('constraint 3: the decline is recorded under the licence message', async () => {
    const {adapters, files} = scripted([
      {surface: 'licenceModal', match: 'licence', answer: 'decline'},
    ]);
    await adapters.licenceDialog.showModal('The licence terms', 'd', [
      'Accept',
      'Cancel',
    ]);
    deepStrictEqual(files.lines(), [
      {
        surface: 'licenceModal',
        question: 'The licence terms',
        answer: 'decline',
        matched: true,
        window: WINDOW,
      },
    ]);
  });

  it('S7: a masked input gets the scripted text', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'maskedInput', match: 'password', answer: {text: 's3cret'}},
      ]).adapters.prompts.maskedInput(
        {placeholder: "alex@dev's password:"},
        NEVER,
      ),
      's3cret',
    );
  });

  /** The files after a masked input answered with `s3cret`. */
  async function filesAfterPassword(): Promise<MemoryFiles> {
    const {adapters, files} = scripted([
      {surface: 'maskedInput', match: 'password', answer: {text: 's3cret'}},
    ]);
    await adapters.prompts.maskedInput(
      {placeholder: "alex@dev's password:"},
      NEVER,
    );
    return files;
  }

  it('S7: a masked input is recorded as supplied', async () => {
    deepStrictEqual(
      (await filesAfterPassword()).lines()[0]?.answer,
      '<supplied>',
    );
  });

  it('S7: no text of the record holds the masked input', async () => {
    strictEqual(
      (await filesAfterPassword()).appended.join('').includes('s3cret'),
      false,
    );
  });

  it('#253: a masked input entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'maskedInput', match: 'password', answer: 'dismiss'},
      ]).adapters.prompts.maskedInput({placeholder: 'password'}, NEVER),
      undefined,
    );
  });

  it('#253: a failure dialog gets the scripted button when it is offered', async () => {
    deepStrictEqual(
      await scripted([
        {
          surface: 'failureDialog',
          match: 'Failed',
          answer: {button: 'Close Remote'},
        },
      ]).adapters.failureDialog.showError('Failed', ['Close Remote', 'Retry']),
      'Close Remote',
    );
  });

  it('#253: a failure dialog entry naming a button that is not offered gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {
          surface: 'failureDialog',
          match: 'Failed',
          answer: {button: 'Close Remote'},
        },
      ]).adapters.failureDialog.showError('Failed', ['Retry']),
      undefined,
    );
  });

  it('#253: a failure dialog entry naming a button that is not offered is recorded as not matched', async () => {
    const {adapters, files} = scripted([
      {
        surface: 'failureDialog',
        match: 'Failed',
        answer: {button: 'Close Remote'},
      },
    ]);
    await adapters.failureDialog.showError('Failed', ['Retry']);
    deepStrictEqual(files.lines()[0]?.matched, false);
  });

  it('#253: a failure dialog entry naming a button that is not offered stays unused', async () => {
    const {adapters} = scripted([
      {
        surface: 'failureDialog',
        match: 'Failed',
        answer: {button: 'Close Remote'},
      },
    ]);
    await adapters.failureDialog.showError('Failed', ['Retry']);
    strictEqual(adapters.unusedEntries(), 1);
  });

  it('#253: a failure dialog entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'failureDialog', match: 'Failed', answer: 'dismiss'},
      ]).adapters.failureDialog.showError('Failed', ['Retry']),
      undefined,
    );
  });

  it('#253: the chosen button of a failure dialog is recorded', async () => {
    const {adapters, files} = scripted([
      {surface: 'failureDialog', match: 'Failed', answer: {button: 'Retry'}},
    ]);
    await adapters.failureDialog.showError('Failed', ['Retry']);
    deepStrictEqual(files.lines()[0]?.answer, 'Retry');
  });

  it('#253: a platform pick gets the scripted platform', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'platformPick', match: 'dev', answer: 'linux'},
      ]).adapters.platformPick.pick(PLATFORM_PICK, NEVER),
      'linux',
    );
  });

  it('#253: a platform pick is matched by its own text with the host filled in', async () => {
    const {adapters, files} = scripted([
      {surface: 'platformPick', match: 'dev', answer: 'windows'},
    ]);
    await adapters.platformPick.pick(PLATFORM_PICK, NEVER);
    strictEqual(files.lines()[0]?.question.includes('dev'), true);
  });

  it('#253: a platform pick entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'platformPick', match: 'dev', answer: 'dismiss'},
      ]).adapters.platformPick.pick(PLATFORM_PICK, NEVER),
      undefined,
    );
  });

  it('#253: the more actions pick gets the scripted action', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'mitigationPick', match: 'More', answer: 'reloadWindow'},
      ]).adapters.mitigationPick.pick(MITIGATION_PICK),
      'reloadWindow',
    );
  });

  it('#253: a more actions entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'mitigationPick', match: 'More', answer: 'dismiss'},
      ]).adapters.mitigationPick.pick(MITIGATION_PICK),
      undefined,
    );
  });

  it('card tooling-24: a matching text input entry answers its text, which the record keeps as typed', async () => {
    const {adapters, files} = scripted([
      {
        surface: 'textInput',
        match: 'Enter SSH Connection Command',
        answer: {text: 'the-command'},
      },
    ]);
    deepStrictEqual(
      [
        await adapters.textInput.showInputBox({
          prompt: 'Enter SSH Connection Command',
        }),
        files.lines(),
      ],
      [
        'the-command',
        [
          {
            surface: 'textInput',
            question: 'Enter SSH Connection Command',
            answer: 'the-command',
            matched: true,
          },
        ],
      ],
    );
  });

  it('card tooling-24: a text input entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'textInput', match: 'Enter SSH', answer: 'dismiss'},
      ]).adapters.textInput.showInputBox({
        prompt: 'Enter SSH Connection Command',
      }),
      undefined,
    );
  });

  it('card tooling-24: a text input with no prompt is matched by its placeholder', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'textInput', match: 'a host', answer: {text: 'the-command'}},
      ]).adapters.textInput.showInputBox({placeholder: 'a host'}),
      'the-command',
    );
  });

  it('card tooling-24: a text input that asks no text is matched by an empty entry', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'textInput', match: '', answer: {text: 'the-command'}},
      ]).adapters.textInput.showInputBox({}),
      'the-command',
    );
  });

  it('card tooling-24: a notice with a matching entry answers its button and records it', async () => {
    const {adapters, files} = scripted([
      {surface: 'notice', match: 'Host added', answer: {button: 'OK'}},
    ]);
    deepStrictEqual(
      [
        await adapters.notice.showInformation('Host added to the config', [
          'OK',
          'Dismiss',
        ]),
        files.lines(),
      ],
      [
        'OK',
        [
          {
            surface: 'notice',
            question: 'Host added to the config',
            answer: 'OK',
            matched: true,
          },
        ],
      ],
    );
  });

  it('card tooling-24: a notice entry that dismisses gives nothing', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'notice', match: 'Host added', answer: 'dismiss'},
      ]).adapters.notice.showInformation('Host added to the config', [
        'OK',
        'Dismiss',
      ]),
      undefined,
    );
  });

  it('card tooling-24: a notice entry naming a button the notice does not offer gives nothing', async () => {
    const {adapters, files} = scripted([
      {surface: 'notice', match: 'Broken', answer: {button: 'Retry'}},
    ]);
    deepStrictEqual(
      [await adapters.notice.showError('Broken', ['OK']), files.lines()],
      [
        undefined,
        [
          {
            surface: 'notice',
            question: 'Broken',
            answer: 'dismiss',
            matched: false,
          },
        ],
      ],
    );
  });

  it('card tooling-24: an unmatched notice is recorded as dismissed and gives nothing', async () => {
    const {adapters, files} = scripted([]);
    deepStrictEqual(
      [await adapters.notice.showWarning('Something', ['OK']), files.lines()],
      [
        undefined,
        [
          {
            surface: 'notice',
            question: 'Something',
            answer: 'dismiss',
            matched: false,
          },
        ],
      ],
    );
  });

  it('constraint 4: three answered questions make three lines in order', async () => {
    const {adapters, files} = scripted([
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
      {surface: 'maskedInput', match: 'password', answer: {text: 'x'}},
      {surface: 'licenceModal', match: '', answer: 'decline'},
    ]);
    await adapters.prompts.pick(FINGERPRINT, NEVER);
    await adapters.prompts.maskedInput({placeholder: 'password'}, NEVER);
    await adapters.licenceDialog.showModal('m', 'd', ['Accept', 'Cancel']);
    deepStrictEqual(
      files.lines().map(line => line.surface),
      ['pick', 'maskedInput', 'licenceModal'],
    );
  });

  it('constraint 4: every line is appended at once, ending in a newline', async () => {
    const {adapters, files} = scripted([]);
    await adapters.prompts.pick(FINGERPRINT, NEVER);
    strictEqual(files.appended[0]?.endsWith('\n'), true);
  });

  it('#253: the scripted adapters translate nothing', () => {
    strictEqual(
      scripted([]).adapters.prompts.translate('Hello {0}'),
      'Hello {0}',
    );
  });

  it('#253: the terminals are the real ones', () => {
    strictEqual(scripted([]).adapters.terminals, REAL.terminals);
  });
});

describe("the scripted adapters' download notification", () => {
  it("F-2103 5.0 step 6: it is the editor's own, which asks nothing", () => {
    const {adapters} = scripted([]);
    deepStrictEqual(adapters.downloadProgress, REAL.downloadProgress);
  });
});

const LOG_FILE = '/run/log.txt';

/** The variables of a harness run: the switch, the record file and the log file. */
const SWITCHED_ON = {
  REMOTE_OSS_ACCEPTANCE: '1',
  REMOTE_OSS_ACCEPTANCE_RECORD: RECORD_FILE,
  REMOTE_OSS_ACCEPTANCE_LOG: LOG_FILE,
};

/** Files that keep every append, by file. */
class AppendedFiles {
  readonly appended = new Map<string, string>();

  readonly read = (): string => '';

  readonly append = (file: string, text: string): void => {
    this.appended.set(file, `${this.appended.get(file) ?? ''}${text}`);
  };

  /** The lines appended to a file. */
  linesOf(file: string): string[] {
    return (this.appended.get(file) ?? '').split('\n').filter(Boolean);
  }
}

const REQUEST: ProgressRequest = {
  title: 'Setting up SSH Host harness',
  cancellable: false,
  onCancel: () => undefined,
  onDetails: () => undefined,
};

/** A real progress port that notes the updates it gets and the request it was given. */
class NotingProgress implements ProgressPort {
  readonly updates: Array<[string, boolean]> = [];

  requests: ProgressRequest[] = [];

  withProgress<Result>(
    request: ProgressRequest,
    task: (
      update: (title: string, details: boolean) => void,
    ) => Promise<Result>,
  ): Promise<Result> {
    this.requests.push(request);
    return task((title, details) => {
      this.updates.push([title, details]);
    });
  }
}

/** The task of the card's rows: it updates `A` with details, then `B` without, and answers 7. */
function twoUpdates(
  update: (title: string, details: boolean) => void,
): Promise<number> {
  update('A', true);
  update('B', false);
  return Promise.resolve(7);
}

describe('progressFor (card tooling-18)', () => {
  const SWITCHED_RECORD = {
    REMOTE_OSS_ACCEPTANCE: '1',
    REMOTE_OSS_ACCEPTANCE_RECORD: RECORD_FILE,
  };

  it('D-85: with the switch off it is the real port itself', () => {
    const real = new NotingProgress();
    strictEqual(
      progressFor(
        {REMOTE_OSS_ACCEPTANCE_RECORD: RECORD_FILE},
        real,
        new AppendedFiles(),
        WINDOW,
      ),
      real,
    );
  });

  it('D-85: with the switch at any value but 1 it is the real port itself', () => {
    const real = new NotingProgress();
    strictEqual(
      progressFor(
        {
          REMOTE_OSS_ACCEPTANCE: 'yes',
          REMOTE_OSS_ACCEPTANCE_RECORD: RECORD_FILE,
        },
        real,
        new AppendedFiles(),
      ),
      real,
    );
  });

  it('D-85: with the switch on and no record file it is the real port itself', () => {
    const real = new NotingProgress();
    strictEqual(
      progressFor(
        {REMOTE_OSS_ACCEPTANCE: '1'},
        real,
        new AppendedFiles(),
        WINDOW,
      ),
      real,
    );
  });

  it('D-85: with the switch on and an empty record file it is the real port itself', () => {
    const real = new NotingProgress();
    strictEqual(
      progressFor(
        {REMOTE_OSS_ACCEPTANCE: '1', REMOTE_OSS_ACCEPTANCE_RECORD: ''},
        real,
        new AppendedFiles(),
        WINDOW,
      ),
      real,
    );
  });

  it('D-85: the record holds the title, then each phase with its details flag, in order', async () => {
    const files = new AppendedFiles();
    await progressFor(
      SWITCHED_RECORD,
      new NotingProgress(),
      files,
      WINDOW,
    ).withProgress(REQUEST, twoUpdates);
    deepStrictEqual(
      withoutTime(
        files.linesOf(RECORD_FILE).map(line => JSON.parse(line) as RecordLine),
      ),
      [
        {
          surface: 'progress',
          question: 'Setting up SSH Host harness',
          answer: 'shown',
          matched: true,
          window: WINDOW,
        },
        {
          surface: 'progress',
          question: 'A',
          answer: 'shown',
          matched: true,
          window: WINDOW,
          details: true,
        },
        {
          surface: 'progress',
          question: 'B',
          answer: 'shown',
          matched: true,
          window: WINDOW,
          details: false,
        },
      ],
    );
  });

  it('D-85: the real port gets both updates, in order, with their details', async () => {
    const real = new NotingProgress();
    await progressFor(
      SWITCHED_RECORD,
      real,
      new AppendedFiles(),
      WINDOW,
    ).withProgress(REQUEST, twoUpdates);
    deepStrictEqual(real.updates, [
      ['A', true],
      ['B', false],
    ]);
  });

  it('D-85: the real port gets the request unchanged', async () => {
    const real = new NotingProgress();
    await progressFor(
      SWITCHED_RECORD,
      real,
      new AppendedFiles(),
      WINDOW,
    ).withProgress(REQUEST, twoUpdates);
    deepStrictEqual(real.requests, [REQUEST]);
  });

  it("D-85: the result is the task's", async () => {
    strictEqual(
      await progressFor(
        SWITCHED_RECORD,
        new NotingProgress(),
        new AppendedFiles(),
        WINDOW,
      ).withProgress(REQUEST, twoUpdates),
      7,
    );
  });

  it('D-85: nothing is appended when the task ends', async () => {
    const files = new AppendedFiles();
    await progressFor(
      SWITCHED_RECORD,
      new NotingProgress(),
      files,
      WINDOW,
    ).withProgress(REQUEST, () => Promise.resolve(0));
    strictEqual(files.linesOf(RECORD_FILE).length, 1);
  });

  it("D-85: a task that fails fails the progress with the task's error", async () => {
    await rejects(
      progressFor(
        SWITCHED_RECORD,
        new NotingProgress(),
        new AppendedFiles(),
        WINDOW,
      ).withProgress(REQUEST, () =>
        Promise.reject(new Error('connect failed')),
      ),
      {message: 'connect failed'},
    );
  });
});

/** A real channel that notes what it is given. */
class NotingChannel implements RevealableChannel {
  readonly lines: string[] = [];

  readonly shown: Array<boolean | undefined> = [];

  disposed = 0;

  appendLine(text: string): void {
    this.lines.push(text);
  }

  show(preserveFocus?: boolean): void {
    this.shown.push(preserveFocus);
  }

  dispose(): void {
    this.disposed += 1;
  }
}

/** A real channel port that hands out one noting channel and remembers its name. */
class NotingChannels implements ChannelPort {
  readonly channel = new NotingChannel();

  readonly names: string[] = [];

  createOutputChannel(name: string): RevealableChannel {
    this.names.push(name);
    return this.channel;
  }
}

describe('channelPortFor (card tooling-18)', () => {
  it('D-85: with the switch off it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      channelPortFor(
        {REMOTE_OSS_ACCEPTANCE_LOG: LOG_FILE},
        real,
        new AppendedFiles(),
      ),
      real,
    );
  });

  it('D-85: with the switch at any value but 1 it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      channelPortFor(
        {REMOTE_OSS_ACCEPTANCE: 'yes', REMOTE_OSS_ACCEPTANCE_LOG: LOG_FILE},
        real,
        new AppendedFiles(),
      ),
      real,
    );
  });

  it('D-85: with the switch on and an empty log variable it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      channelPortFor(
        {REMOTE_OSS_ACCEPTANCE: '1', REMOTE_OSS_ACCEPTANCE_LOG: ''},
        real,
        new AppendedFiles(),
      ),
      real,
    );
  });

  it('D-85: with the switch on and no log variable it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      channelPortFor({REMOTE_OSS_ACCEPTANCE: '1'}, real, new AppendedFiles()),
      real,
    );
  });

  it('D-85: the file holds both lines, in order, each ending in a newline', () => {
    const files = new AppendedFiles();
    const channel = channelPortFor(
      SWITCHED_ON,
      new NotingChannels(),
      files,
    ).createOutputChannel('Remote - SSH');
    channel.appendLine('first');
    channel.appendLine('second');
    strictEqual(files.appended.get(LOG_FILE), 'first\nsecond\n');
  });

  it('D-85: the real channel gets both lines too', () => {
    const real = new NotingChannels();
    const channel = channelPortFor(
      SWITCHED_ON,
      real,
      new AppendedFiles(),
    ).createOutputChannel('Remote - SSH');
    channel.appendLine('first');
    channel.appendLine('second');
    deepStrictEqual(real.channel.lines, ['first', 'second']);
  });

  it('D-85: the real channel is opened under the name asked for', () => {
    const real = new NotingChannels();
    channelPortFor(SWITCHED_ON, real, new AppendedFiles()).createOutputChannel(
      'Remote - SSH',
    );
    deepStrictEqual(real.names, ['Remote - SSH']);
  });

  it('D-85: show and dispose reach the real channel', () => {
    const real = new NotingChannels();
    const channel = channelPortFor(
      SWITCHED_ON,
      real,
      new AppendedFiles(),
    ).createOutputChannel('Remote - SSH');
    channel.show(false);
    channel.dispose();
    deepStrictEqual([real.channel.shown, real.channel.disposed], [[false], 1]);
  });
});

describe('the windows of one script (card tooling-20)', () => {
  const FOR_B: ScriptEntry = {
    surface: 'pick',
    match: 'authenticity',
    answer: 'yes',
    window: 'b',
  };

  it('D-85: an entry for window b is answered by b', async () => {
    deepStrictEqual(
      await scripted([FOR_B], 'b').adapters.prompts.pick(FINGERPRINT, NEVER),
      'yes',
    );
  });

  it('D-85: an entry for window b is not answered by a', async () => {
    deepStrictEqual(
      await scripted([FOR_B], 'a').adapters.prompts.pick(FINGERPRINT, NEVER),
      undefined,
    );
  });

  it('D-85: an entry for window b does not use up the cursor of a', async () => {
    deepStrictEqual(
      await scripted(
        [FOR_B, {surface: 'pick', match: 'authenticity', answer: 'no'}],
        'a',
      ).adapters.prompts.pick(FINGERPRINT, NEVER),
      'no',
    );
  });

  it('D-85: an entry with no window is answered by every window', async () => {
    const entries: ScriptEntry[] = [
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
    ];
    deepStrictEqual(
      [
        await scripted(entries, 'a').adapters.prompts.pick(FINGERPRINT, NEVER),
        await scripted(entries, 'b').adapters.prompts.pick(FINGERPRINT, NEVER),
      ],
      ['yes', 'yes'],
    );
  });

  it('D-85: a line of the record names the window that wrote it', async () => {
    const {adapters, files} = scripted([FOR_B], 'b');
    await adapters.prompts.pick(FINGERPRINT, NEVER);
    deepStrictEqual(
      files.lines().map(line => line.window),
      ['b'],
    );
  });

  it('D-85: a window with a folder is named by the last segment of its path', () => {
    strictEqual(windowNameOf('/home/harness/a'), 'a');
  });

  it('D-85: a trailing slash does not make a window nameless', () => {
    strictEqual(windowNameOf('/home/harness/b/'), 'b');
  });

  it('D-85: a window with no folder is local', () => {
    strictEqual(windowNameOf(undefined), 'local');
  });

  it('D-85: a window on the root folder is local', () => {
    strictEqual(windowNameOf('/'), 'local');
  });
});
