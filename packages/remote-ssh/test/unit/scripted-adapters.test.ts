import {deepStrictEqual, strictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {licenceModalOf} from '../../src/surfaces/licence-modal.ts';
import type {EditorAdapters} from '../../src/editor-surfaces.ts';
import {
  adaptersFor,
  type RecordLine,
  type ScriptEntry,
  scriptedAdapters,
} from '../../src/surfaces/scripted-adapters.ts';

const SCRIPT_FILE = '/run/script.json';
const RECORD_FILE = '/run/record.jsonl';
const NEVER = new AbortController().signal;

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

  /** The record as parsed lines. */
  lines(): RecordLine[] {
    return this.appended
      .join('')
      .split('\n')
      .filter(line => line !== '')
      .map(line => JSON.parse(line) as RecordLine);
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
};

/** The scripted adapters over `entries`, with the files they wrote to. */
function scripted(entries: ScriptEntry[]) {
  const files = filesWith(entries);
  const adapters = scriptedAdapters(SCRIPT_FILE, RECORD_FILE, REAL, files);
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
    strictEqual(adaptersFor({}, REAL, files), REAL);
  });

  it('constraint 7: with the switch at 0 it uses the real adapters', () => {
    strictEqual(
      adaptersFor({...ENABLED, REMOTE_OSS_ACCEPTANCE: '0'}, REAL, files),
      REAL,
    );
  });

  it('constraint 2: with the switch on and no script it uses the real adapters', () => {
    strictEqual(
      adaptersFor(
        {...ENABLED, REMOTE_OSS_ACCEPTANCE_SCRIPT: undefined},
        REAL,
        files,
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
      ),
      REAL,
    );
  });

  it('constraint 2: with the switch on and an empty script name it uses the real adapters', () => {
    strictEqual(
      adaptersFor({...ENABLED, REMOTE_OSS_ACCEPTANCE_SCRIPT: ''}, REAL, files),
      REAL,
    );
  });

  it('constraint 2: with the switch on and an empty record name it uses the real adapters', () => {
    strictEqual(
      adaptersFor({...ENABLED, REMOTE_OSS_ACCEPTANCE_RECORD: ''}, REAL, files),
      REAL,
    );
  });

  it('constraint 1: with the switch on and both files it uses adapters that are not the real ones', () => {
    strictEqual(adaptersFor(ENABLED, REAL, filesWith([])) === REAL, false);
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
