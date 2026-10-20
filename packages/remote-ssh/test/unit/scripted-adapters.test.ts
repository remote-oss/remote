import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {NotingChannels} from 'lib-log/testing/noting-channels';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {
  buildFileChoice,
  type FileChoice,
} from '../../src/config/file-choice.ts';
import {pickerModel, type PickerModel} from '../../src/connect/picker-model.ts';
import {licenceModalOf} from '../../src/surfaces/licence-modal.ts';
import type {EditorAdapters} from '../../src/editor-surfaces.ts';
import type {
  EditorResolver,
  ProgressPort,
  ProgressRequest,
  ResolvedConnection,
  ResolverEditor,
} from 'lib-authority';
import {
  adaptersFor,
  authorityReportingResolverEditorOf,
  claimedWindowName,
  channelPortFor,
  progressFor,
  type RecordLine,
  type ScriptEntry,
  scriptedAdapters,
  windowNameFor,
  windowNameOf,
} from '../../src/surfaces/scripted-adapters.ts';

const SCRIPT_FILE = '/run/script.json';
const RECORD_FILE = '/run/record.jsonl';
const SIGNALS_FOLDER = '/run/signals';

/**
 * A poll that ends at once but yields to the event loop, so a test's own timers still run: the tests create the
 * signal files themselves.
 */
function immediateSleep(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}
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
    this.contents.set(file, (this.contents.get(file) ?? '') + text);
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
  linkTerminals: {runProgram: () => Promise.resolve()},
  failureDialog: {showError: () => Promise.resolve('real')},
  licenceDialog: {showModal: () => Promise.resolve('real')},
  preconnectDialog: {showModal: () => Promise.resolve('real')},
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
  hostPick: {pick: () => Promise.resolve(undefined)},
  filePick: {pick: () => Promise.resolve(undefined)},
};

/** The scripted adapters over `entries`, with the files they wrote to and, for a held entry, the signals folder. */
function scripted(
  entries: ScriptEntry[],
  windowName = WINDOW,
  signalsFolder?: string,
) {
  const files = filesWith(entries);
  const adapters = scriptedAdapters(
    SCRIPT_FILE,
    RECORD_FILE,
    REAL,
    files,
    windowName,
    signalsFolder,
    immediateSleep,
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
  active: 'linux' as const,
  items: [
    {label: 'Linux', platform: 'linux' as const},
    {label: 'Windows', platform: 'windows' as const},
  ],
};

const MITIGATION_PICK = {
  placeholder: 'More actions',
  items: [{label: 'Reload', action: 'reloadWindow' as const}],
};

const HOSTS = {hosts: [{name: 'harness', file: '/f'}]};

/** The host pick's model for a typed text; a parse error is not expected in this test. */
function hostModel(typedText = ''): PickerModel {
  const model = pickerModel(HOSTS, typedText);
  if ('parseError' in model) {
    throw new Error('no model');
  }
  return model;
}

const FILE_CHOICE: FileChoice = buildFileChoice({
  configFile: '/run/ssh_config',
  userFile: '/h/.ssh/config',
  systemFile: '/etc/ssh/ssh_config',
});

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
    const adapters = adaptersFor({}, REAL, files, WINDOW);
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
        undefined,
        immediateSleep,
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
        undefined,
        immediateSleep,
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
        undefined,
        immediateSleep,
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

  it('constraint 3: the licence modal can only decline: it gives nothing, as the editor’s Cancel does', async () => {
    deepStrictEqual(
      await scripted([
        {surface: 'licenceModal', match: '', answer: 'decline'},
      ]).adapters.licenceDialog.showModal('m', 'd', ['Accept and Continue']),
      undefined,
    );
  });

  it('constraint 3: the modal of the extension reads a decline as a cancel, never as an acceptance', async () => {
    deepStrictEqual(
      await licenceModalOf(
        scripted([{surface: 'licenceModal', match: '', answer: 'decline'}])
          .adapters.licenceDialog,
        template => template,
        {displayName: 'Remote'},
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
        detail: 'd',
      },
    ]);
  });

  it('F-3902 AC-14: the licence modal line keeps the detail the modal was shown with, also when nothing matches', async () => {
    const {adapters, files} = scripted([]);
    await adapters.licenceDialog.showModal(
      'The licence terms',
      'Read the terms at https://example.invalid/terms.',
      ['Accept', 'Cancel'],
    );
    deepStrictEqual(
      files.lines().map(line => line.detail),
      ['Read the terms at https://example.invalid/terms.'],
    );
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

  it('F-2206 AC-2: a platform pick records its items in order and the label of the focused one', async () => {
    const {adapters, files} = scripted([
      {surface: 'platformPick', match: 'dev', answer: 'linux'},
    ]);
    await adapters.platformPick.pick(
      {...PLATFORM_PICK, active: 'windows'},
      NEVER,
    );
    const [line] = files.lines();
    deepStrictEqual(
      [line?.items, line?.active],
      [['Linux', 'Windows'], 'Windows'],
    );
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

  it('F-2409 AC-29: a mitigation pick record line carries its items', async () => {
    const {adapters, files} = scripted([
      {surface: 'mitigationPick', match: 'More', answer: 'reloadWindow'},
    ]);
    await adapters.mitigationPick.pick(MITIGATION_PICK);
    deepStrictEqual(
      files.lines().map(line => (line as {items?: string[]}).items),
      [['Reload']],
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
            window: WINDOW,
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

  it('card connect-22: a text input with a title is matched by its title, and the record keeps the title as the question', async () => {
    const {adapters, files} = scripted([
      {surface: 'textInput', match: 'Enter SSH', answer: {text: 'host1'}},
    ]);
    await adapters.textInput.showInputBox({
      title: 'Enter SSH Connection Command',
      prompt: 'ignored',
      placeholder: 'ignored',
    });
    deepStrictEqual(
      files.lines().map(line => (line as {question: string}).question),
      ['Enter SSH Connection Command'],
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
            buttons: ['OK', 'Dismiss'],
            window: WINDOW,
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
            buttons: ['OK'],
            window: WINDOW,
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
            buttons: ['OK'],
            window: WINDOW,
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

  it('F-2311 5.0 step 5: the terminals that make the agent link are the real ones', () => {
    strictEqual(scripted([]).adapters.linkTerminals, REAL.linkTerminals);
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

describe('the scripted host pick (card tooling-25)', () => {
  function hostPickOf(entries: ScriptEntry[]) {
    const {adapters, files} = scripted(entries);
    const filesLines = files.lines.bind(files);
    const pick = adapters.hostPick.pick.bind(adapters.hostPick);
    return {pick, lines: filesLines};
  }

  it('a label answer gives the host row', async () => {
    const {pick, lines} = hostPickOf([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: {label: 'harness'},
      },
    ]);
    const taken = await pick(hostModel(), typedText => hostModel(typedText));
    deepStrictEqual(
      [taken, lines()[0]?.answer, lines()[0]?.matched],
      [{kind: 'host', label: 'harness', keepVisible: false}, 'harness', true],
    );
  });

  it('a label answer gives a fixed row by its text', async () => {
    const {pick} = hostPickOf([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: {label: 'Configure SSH Hosts...'},
      },
    ]);
    deepStrictEqual(
      await pick(hostModel(), typedText => hostModel(typedText)),
      {
        kind: 'configure',
        label: {id: 'S024', values: []},
        keepVisible: true,
      },
    );
  });

  it('a typed answer gives the typed row of the typed model, the hosts still first', async () => {
    const {pick} = hostPickOf([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: {typed: 'harness@127.0.0.1'},
      },
    ]);
    deepStrictEqual(
      await pick(hostModel(), typedText => hostModel(typedText)),
      {
        kind: 'typed',
        label: '➤ harness@127.0.0.1',
        text: 'harness@127.0.0.1',
        keepVisible: true,
      },
    );
  });

  it('a typed answer whose model has no typed row fails closed', async () => {
    const {pick, lines} = hostPickOf([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: {typed: 'x'},
      },
    ]);
    const model: PickerModel = {
      placeholder: {id: 'S127', values: []},
      items: [{kind: 'host', label: 'harness', keepVisible: false}],
    };
    deepStrictEqual(
      [await pick(model, () => model), lines()[0]?.matched, lines()[0]?.answer],
      [undefined, false, 'dismiss'],
    );
  });

  it('a dismiss answer gives nothing', async () => {
    const {pick, lines} = hostPickOf([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: 'dismiss',
      },
    ]);
    deepStrictEqual(
      [
        await pick(hostModel(), typedText => hostModel(typedText)),
        lines()[0]?.answer,
        lines()[0]?.matched,
      ],
      [undefined, 'dismiss', true],
    );
  });

  it('a label no row has fails closed and records matched false', async () => {
    const {pick, lines} = hostPickOf([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: {label: 'absent'},
      },
    ]);
    deepStrictEqual(
      [
        await pick(hostModel(), typedText => hostModel(typedText)),
        lines()[0]?.matched,
        lines()[0]?.answer,
      ],
      [undefined, false, 'dismiss'],
    );
  });

  it('the record line names the question, the answer and the items shown', async () => {
    const {pick, lines} = hostPickOf([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: 'dismiss',
      },
    ]);
    await pick(hostModel(), typedText => hostModel(typedText));
    deepStrictEqual(lines()[0], {
      surface: 'hostPick',
      question: 'Select configured SSH host or enter user@host',
      answer: 'dismiss',
      matched: true,
      window: WINDOW,
      items: [
        'harness',
        '$(plus) Add New SSH Host...',
        'Configure SSH Hosts...',
      ],
    });
  });
});

describe('the scripted configuration-file pick (card tooling-25)', () => {
  function filePickOf(entries: ScriptEntry[]) {
    const {adapters, files} = scripted(entries);
    const filesLines = files.lines.bind(files);
    const pick = adapters.filePick.pick.bind(adapters.filePick);
    return {pick, lines: filesLines};
  }

  it('a label answer gives the file row by its path', async () => {
    const {pick} = filePickOf([
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: {label: '/run/ssh_config'},
      },
    ]);
    deepStrictEqual(await pick(FILE_CHOICE), {
      kind: 'file',
      label: '/run/ssh_config',
      role: 'configured',
    });
  });

  it('a label answer gives the settings row by its text', async () => {
    const {pick} = filePickOf([
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: {label: 'Settings'},
      },
    ]);
    deepStrictEqual(await pick(FILE_CHOICE), FILE_CHOICE.items[1]);
  });

  it('a label no row has fails closed', async () => {
    const {pick, lines} = filePickOf([
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: {label: 'absent'},
      },
    ]);
    deepStrictEqual(
      [await pick(FILE_CHOICE), lines()[0]?.matched],
      [undefined, false],
    );
  });

  it('a dismiss answer gives nothing', async () => {
    const {pick, lines} = filePickOf([
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: 'dismiss',
      },
    ]);
    deepStrictEqual(
      [await pick(FILE_CHOICE), lines()[0]?.answer, lines()[0]?.matched],
      [undefined, 'dismiss', true],
    );
  });

  it('the record line names the placeholder, the answer and the items shown', async () => {
    const {pick, lines} = filePickOf([
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: {label: 'Help'},
      },
    ]);
    await pick(FILE_CHOICE);
    deepStrictEqual(lines()[0], {
      surface: 'filePick',
      question: 'Edit custom SSH configuration file',
      answer: 'Help',
      matched: true,
      window: WINDOW,
      items: ['/run/ssh_config', 'Settings', 'Help'],
    });
  });
});

const ENDED = {
  surface: 'progressEnd',
  question: 'Setting up SSH Host harness',
  answer: 'ended',
  matched: true,
  window: WINDOW,
};

/** The progress record the files hold, without the times. */
function progressRecordOf(files: AppendedFiles) {
  return withoutTime(
    files.linesOf(RECORD_FILE).map(line => JSON.parse(line) as RecordLine),
  );
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
        WINDOW,
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
    deepStrictEqual(progressRecordOf(files), [
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
      ENDED,
    ]);
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

  it('F-2304.AC-8: a task that fulfils ends the record with one progressEnd line, after the phase lines, with the title', async () => {
    const files = new AppendedFiles();
    await progressFor(
      SWITCHED_RECORD,
      new NotingProgress(),
      files,
      WINDOW,
    ).withProgress(REQUEST, twoUpdates);
    deepStrictEqual(progressRecordOf(files).slice(-2), [
      {
        surface: 'progress',
        question: 'B',
        answer: 'shown',
        matched: true,
        window: WINDOW,
        details: false,
      },
      ENDED,
    ]);
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

  it('F-2304.AC-8: a task that fails also ends the record with the progressEnd line', async () => {
    const files = new AppendedFiles();
    await progressFor(SWITCHED_RECORD, new NotingProgress(), files, WINDOW)
      .withProgress(REQUEST, () => Promise.reject(new Error('connect failed')))
      .catch(() => undefined);
    deepStrictEqual(progressRecordOf(files).slice(1), [ENDED]);
  });

  it('D-85: with the switch off no line is appended at all', async () => {
    const files = new AppendedFiles();
    await progressFor(
      {REMOTE_OSS_ACCEPTANCE_RECORD: RECORD_FILE},
      new NotingProgress(),
      files,
      WINDOW,
    ).withProgress(REQUEST, twoUpdates);
    deepStrictEqual(files.linesOf(RECORD_FILE), []);
  });
});

describe('channelPortFor (card tooling-18)', () => {
  it('D-85: with the switch on, the lines go to the file REMOTE_OSS_ACCEPTANCE_LOG names, and to the real channel', () => {
    const files = new AppendedFiles();
    const real = new NotingChannels();
    const channel = channelPortFor(
      SWITCHED_ON,
      real,
      files,
    ).createOutputChannel('Remote - SSH');
    channel.appendLine('first');
    deepStrictEqual(
      [files.appended.get(LOG_FILE), real.channel.lines],
      ['first\n', ['first']],
    );
  });

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

describe('a notice line of the record (card connect-25)', () => {
  it('a notice record line carries its buttons, in order', async () => {
    const {adapters, files} = scripted([
      {surface: 'notice', match: 'You selected', answer: 'dismiss'},
    ]);
    await adapters.notice.showInformation('You selected "linux"', [
      "Don't Show Again",
      'Other',
    ]);
    deepStrictEqual(
      files.lines().map(line => line.buttons),
      [["Don't Show Again", 'Other']],
    );
  });

  it('a notice nothing in the script matches still carries its buttons', async () => {
    const {adapters, files} = scripted([]);
    await adapters.notice.showInformation('Something else', ['OK']);
    deepStrictEqual(
      files.lines().map(line => line.buttons),
      [['OK']],
    );
  });
});

describe('the window name the harness gives a window (card tooling-28)', () => {
  const WINDOWS = '/run/windows/pids';

  it('with the variable set, the name waits for the pid file and takes its content', async () => {
    const waits: number[] = [];
    let reads = 0;
    let file = '';
    const name = await claimedWindowName(
      WINDOWS,
      42,
      {
        read: (each: string): string | undefined => {
          reads += 1;
          file = each;
          return reads >= 2 ? 'empty-1' : undefined;
        },
      },
      milliseconds => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      () => 0,
    );
    deepStrictEqual(
      {name, waits, reads, file},
      {
        name: 'empty-1',
        waits: [50],
        reads: 2,
        file: path.join(WINDOWS, '42'),
      },
    );
  });

  it('with the variable set and no pid file within the wait, the name is unclaimed-<pid>', async () => {
    let ticks = 0;
    const name = await claimedWindowName(
      WINDOWS,
      42,
      {read: (): string | undefined => undefined},
      () => Promise.resolve(),
      () => {
        ticks += 5_001;
        return ticks;
      },
    );
    strictEqual(name, 'unclaimed-42');
  });

  it('with the variable unset, the name is the window name as before, without a pid file read', async () => {
    const name = await windowNameFor(
      {},
      42,
      '/home/harness/b',
      {
        read: (each: string): string | undefined => {
          throw new Error(`no pid file is read without the variable: ${each}`);
        },
      },
      () => Promise.resolve(),
      () => 0,
    );
    strictEqual(name, 'b');
  });
});

describe('the authority the resolver reports beside the pid file (card tooling-28)', () => {
  const WINDOWS = '/run/windows/pids';

  it('without the variable, the resolver editor is the same editor, unwrapped', () => {
    const editor = {} as unknown as ResolverEditor;
    strictEqual(
      authorityReportingResolverEditorOf({}, 42, editor, () => undefined),
      editor,
    );
  });

  it('with the variable set, the resolve reports its authority before resolving', async () => {
    const authorities: Array<[string, string]> = [];
    let registered: [string, EditorResolver] | undefined;
    const editor = {
      registerRemoteAuthorityResolver: (
        prefix: string,
        resolver: EditorResolver,
      ): {dispose(): void} => {
        registered = [prefix, resolver];
        return {dispose: () => undefined};
      },
    } as unknown as ResolverEditor;
    const wrapped = authorityReportingResolverEditorOf(
      {REMOTE_OSS_ACCEPTANCE_WINDOWS: WINDOWS},
      42,
      editor,
      (file: string, authority: string) => {
        authorities.push([file, authority]);
      },
    );
    wrapped.registerRemoteAuthorityResolver('ssh-remote', {
      resolve: (): Promise<ResolvedConnection> =>
        Promise.resolve({
          host: 'harness',
          port: 4000,
          connectionToken: 'window-token',
          extensionHostEnv: {},
          environmentTunnels: [],
        }),
    });
    const resolved = await registered?.[1]?.resolve('ssh-remote+harness', {
      resolveAttempt: 1,
    });
    deepStrictEqual(
      [authorities, registered?.[0], resolved?.port],
      [
        [[path.join(WINDOWS, '42.authority'), 'ssh-remote+harness']],
        'ssh-remote',
        4000,
      ],
    );
  });
});

describe('the script read per question, the cursor from the record and the held answers (card tooling-26)', () => {
  const PASSWORD = {placeholder: "harness-pw@dev's password:"};

  /** The entry a row holds behind its signal. */
  function heldEntry(): ScriptEntry {
    return {
      surface: 'maskedInput',
      match: 'password',
      answer: {text: 'secret'},
      after: 'go',
    };
  }

  /** The line a held entry writes while it waits, without its append time. */
  function heldLine(question: string): Omit<RecordLine, 'time'> {
    return {
      surface: 'maskedInput',
      question,
      answer: 'held',
      matched: true,
      held: true,
      window: WINDOW,
    };
  }

  /** The line a held entry that cannot be signalled writes, without its append time. */
  function dismissedLine(): Omit<RecordLine, 'time'> {
    return {
      surface: 'maskedInput',
      question: PASSWORD.placeholder,
      answer: 'dismiss',
      matched: false,
      window: WINDOW,
    };
  }

  /** Creates the run's signal file `name`. */
  function signal(files: MemoryFiles, name: string): void {
    files.contents.set(path.join(SIGNALS_FOLDER, name), '');
  }

  it('D-85: an entry appended after the first question is used by the next question', async () => {
    const first: ScriptEntry = {
      surface: 'pick',
      match: 'authenticity',
      answer: 'yes',
    };
    const second: ScriptEntry = {
      surface: 'pick',
      match: 'authenticity',
      answer: 'no',
    };
    const {adapters, files} = scripted([first]);
    const answered1 = await adapters.prompts.pick(FINGERPRINT, NEVER);
    // The append lands between the two questions: the next question reads the new list.
    files.contents.set(SCRIPT_FILE, JSON.stringify({entries: [first, second]}));
    const answered2 = await adapters.prompts.pick(FINGERPRINT, NEVER);
    deepStrictEqual([answered1, answered2], ['yes', 'no']);
  });

  it('D-85: a new adapter set for the same window continues at the count of its record lines', async () => {
    const entries: ScriptEntry[] = [
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
      {surface: 'pick', match: 'sure', answer: 'no'},
    ];
    const files = filesWith(entries);
    const firstSet = scriptedAdapters(
      SCRIPT_FILE,
      RECORD_FILE,
      REAL,
      files,
      WINDOW,
      undefined,
      immediateSleep,
    );
    const firstPick = firstSet.prompts.pick(FINGERPRINT, NEVER);
    // A reload gives a new adapter set over the same script and record.
    const secondSet = scriptedAdapters(
      SCRIPT_FILE,
      RECORD_FILE,
      REAL,
      files,
      WINDOW,
      undefined,
      immediateSleep,
    );
    const secondPick = secondSet.prompts.pick(
      {placeholder: 'Are you sure?', items: FINGERPRINT.items},
      NEVER,
    );
    deepStrictEqual(
      [await firstPick, await secondPick, secondSet.unusedEntries()],
      ['yes', 'no', 0],
    );
  });

  it('D-85: a held entry writes its held line, waits, and answers once the signal file exists', async () => {
    const {adapters, files} = scripted([heldEntry()], WINDOW, SIGNALS_FOLDER);
    const done = adapters.prompts.maskedInput(PASSWORD, NEVER);
    const heldFirst = files.lines();
    setTimeout(() => {
      signal(files, 'go');
    }, 10);
    deepStrictEqual(
      [heldFirst, await done, files.lines()],
      [
        [heldLine(PASSWORD.placeholder)],
        'secret',
        [
          heldLine(PASSWORD.placeholder),
          {
            surface: 'maskedInput',
            question: PASSWORD.placeholder,
            answer: '<supplied>',
            matched: true,
            window: WINDOW,
          },
        ],
      ],
    );
  });

  it('D-85: the default sleep is the real one, so a held entry answers once its signal lands', async () => {
    const files = filesWith([heldEntry()]);
    const adapters = scriptedAdapters(
      SCRIPT_FILE,
      RECORD_FILE,
      REAL,
      files,
      WINDOW,
      SIGNALS_FOLDER,
    );
    const done = adapters.prompts.maskedInput(PASSWORD, NEVER);
    setTimeout(() => {
      signal(files, 'go');
    }, 150);
    deepStrictEqual(await done, 'secret');
  });

  it('D-85: a held entry whose cancellation ends writes withdrawn and gives nothing', async () => {
    const {adapters, files} = scripted([heldEntry()], WINDOW, SIGNALS_FOLDER);
    const controller = new AbortController();
    const done = adapters.prompts.maskedInput(PASSWORD, controller.signal);
    const heldFirst = files.lines();
    controller.abort();
    deepStrictEqual(
      [heldFirst, await done, files.lines()],
      [
        [heldLine(PASSWORD.placeholder)],
        undefined,
        [
          heldLine(PASSWORD.placeholder),
          {
            surface: 'maskedInput',
            question: PASSWORD.placeholder,
            answer: 'withdrawn',
            matched: true,
            window: WINDOW,
          },
        ],
      ],
    );
  });

  it('D-85: a held entry counts once for the cursor', async () => {
    const entries: ScriptEntry[] = [
      heldEntry(),
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
    ];
    const {adapters, files} = scripted(entries, WINDOW, SIGNALS_FOLDER);
    const done = adapters.prompts.maskedInput(PASSWORD, NEVER);
    signal(files, 'go');
    const afterReload = scriptedAdapters(
      SCRIPT_FILE,
      RECORD_FILE,
      REAL,
      files,
      WINDOW,
      SIGNALS_FOLDER,
      immediateSleep,
    );
    // The held line does not count: one entry is answered, one stays unused.
    deepStrictEqual(
      [
        await done,
        adapters.unusedEntries(),
        await afterReload.prompts.pick(FINGERPRINT, NEVER),
        afterReload.unusedEntries(),
      ],
      ['secret', 1, 'yes', 0],
    );
  });

  it('D-85: a held failure dialog waits for its signal', async () => {
    const {adapters, files} = scripted(
      [
        {
          surface: 'failureDialog',
          match: 'Failed',
          answer: {button: 'Retry'},
          after: 'go',
        },
      ],
      WINDOW,
      SIGNALS_FOLDER,
    );
    const done = adapters.failureDialog.showError('Failed', [
      'Retry',
      'Close Remote',
    ]);
    const heldFirst = files.lines();
    signal(files, 'go');
    deepStrictEqual(
      [heldFirst, await done, files.lines().at(-1)?.answer],
      [
        [
          {
            surface: 'failureDialog',
            question: 'Failed',
            answer: 'held',
            matched: true,
            held: true,
            window: WINDOW,
            buttons: ['Retry', 'Close Remote'],
          },
        ],
        'Retry',
        'Retry',
      ],
    );
  });

  it('D-85: a display-only line and an unparseable line do not move the cursor', async () => {
    const entries: ScriptEntry[] = [
      {surface: 'pick', match: 'authenticity', answer: 'yes'},
      {surface: 'pick', match: 'sure', answer: 'no'},
    ];
    const files = new MemoryFiles(
      new Map([
        [SCRIPT_FILE, JSON.stringify({entries})],
        [
          RECORD_FILE,
          [
            JSON.stringify({
              surface: 'progress',
              question: 'Connecting',
              answer: 'shown',
              matched: true,
              window: WINDOW,
              time: 1,
            }),
            'not a line of the record',
            JSON.stringify({
              surface: 'pick',
              question: 'The authenticity of host',
              answer: 'no',
              matched: true,
              window: 'b',
              time: 2,
            }),
            JSON.stringify({
              surface: 'pick',
              question: 'The authenticity of host',
              answer: 'yes',
              matched: true,
              window: WINDOW,
              time: 3,
            }),
          ].join('\n'),
        ],
      ]),
    );
    const adapters = scriptedAdapters(
      SCRIPT_FILE,
      RECORD_FILE,
      REAL,
      files,
      WINDOW,
      undefined,
      immediateSleep,
    );
    // The cursor counts the window's own answered entry line: not the progress line, not the unparseable one, not another window's.
    const unusedBefore = adapters.unusedEntries();
    const pick2 = adapters.prompts.pick(
      {placeholder: 'Are you sure?', items: FINGERPRINT.items},
      NEVER,
    );
    deepStrictEqual([unusedBefore, await pick2], [1, 'no']);
  });

  it('D-85: a held entry in a run that names no signals folder is dismissed and leaves the entry', async () => {
    const {adapters, files} = scripted([heldEntry()]);
    const dismissed = adapters.prompts.maskedInput(PASSWORD, NEVER);
    deepStrictEqual(
      [await dismissed, files.lines(), adapters.unusedEntries()],
      [undefined, [dismissedLine()], 1],
    );
  });

  it('D-85: a held entry that names no signal fails closed the same way', async () => {
    const {adapters, files} = scripted(
      [
        {
          surface: 'maskedInput',
          match: 'password',
          answer: {text: 'secret'},
          after: 'go/never',
        },
      ],
      WINDOW,
      SIGNALS_FOLDER,
    );
    const dismissed = adapters.prompts.maskedInput(PASSWORD, NEVER);
    const outcome = [await dismissed, files.lines(), adapters.unusedEntries()];
    deepStrictEqual(outcome, [undefined, [dismissedLine()], 1]);
  });
});

describe('the pre-connection dialog of the scripted adapters (card connect-87)', () => {
  const BUTTONS = ['Allow', "Allow and Don't Ask Again", 'Skip'];

  it('F-2108 AC-4: the dialog gets the scripted button when it is offered, and the record line carries the detail and the buttons', async () => {
    const {adapters, files} = scripted([
      {
        surface: 'preconnectDialog',
        match: 'Execute pre-connection script',
        answer: {button: 'Allow'},
      },
    ]);
    const chosen = await adapters.preconnectDialog.showModal(
      'Execute pre-connection script?',
      "'/x.sh' will be executed on your local machine.",
      BUTTONS,
    );
    deepStrictEqual(
      [
        chosen,
        files
          .lines()
          .map(line => [line.surface, line.answer, line.detail, line.buttons]),
      ],
      [
        'Allow',
        [
          [
            'preconnectDialog',
            'Allow',
            "'/x.sh' will be executed on your local machine.",
            BUTTONS,
          ],
        ],
      ],
    );
  });

  it('F-2108 AC-10: an entry that dismisses gives nothing, and one naming a button that is not offered gives nothing and stays unused', async () => {
    const dismissed = scripted([
      {surface: 'preconnectDialog', match: '', answer: 'dismiss'},
    ]);
    const missing = scripted([
      {surface: 'preconnectDialog', match: '', answer: {button: 'Other'}},
    ]);
    deepStrictEqual(
      [
        await dismissed.adapters.preconnectDialog.showModal('m', 'd', BUTTONS),
        await missing.adapters.preconnectDialog.showModal('m', 'd', BUTTONS),
        missing.adapters.unusedEntries(),
      ],
      [undefined, undefined, 1],
    );
  });
});
