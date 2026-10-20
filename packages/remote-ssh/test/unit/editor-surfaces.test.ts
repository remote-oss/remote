import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {
  type EditorAdapters,
  type EditorOperations,
  editorSurfacesOf,
  type SurfaceContext,
} from '../../src/editor-surfaces.ts';
import type {MitigationAction} from '../../src/surfaces/mitigation-picker.ts';
import {SILENT_PROGRESS, SILENT_PROMPTS} from './pipeline.fixture.ts';

/** What the fakes were asked, in order. */
interface Calls {
  operations: string[];
  writes: Array<[string, unknown]>;
  stored: Array<[string, unknown]>;
  errors: Array<[string, readonly string[]]>;
  logged: MemorySink;
}

/** The surfaces over fakes: the dialog answers `dialogAnswer`, the picks `mitigation` and `platform`. */
function surfacesWith(
  changes: {
    dialogAnswer?: string;
    mitigation?: MitigationAction;
    platform?: 'linux' | 'windows' | 'macOS';
    writtenPlatforms?: unknown;
    accepted?: Record<string, unknown>;
    noticeFails?: boolean;
  } = {},
): {surfaces: ReturnType<typeof editorSurfacesOf>; calls: Calls} {
  const calls: Calls = {
    operations: [],
    writes: [],
    stored: [],
    errors: [],
    logged: new MemorySink(),
  };
  function noted(name: string): () => Promise<void> {
    return () => {
      calls.operations.push(name);
      return Promise.resolve();
    };
  }
  const adapters: EditorAdapters = {
    prompts: SILENT_PROMPTS,
    terminals: new RecordingTerminals(),
    linkTerminals: {runProgram: () => Promise.resolve()},
    failureDialog: {showError: () => Promise.resolve(changes.dialogAnswer)},
    licenceDialog: {showModal: () => Promise.resolve(undefined)},
    preconnectDialog: {showModal: () => Promise.resolve(undefined)},
    platformPick: {pick: () => Promise.resolve(changes.platform)},
    mitigationPick: {pick: () => Promise.resolve(changes.mitigation)},
    downloadProgress: SILENT_PROGRESS,
    textInput: {showInputBox: () => Promise.resolve(undefined)},
    notice: {
      showInformation: () => Promise.resolve(undefined),
      showWarning: () => Promise.resolve(undefined),
      showError: (message, buttons) => {
        calls.errors.push([message, buttons]);
        return changes.noticeFails === true
          ? Promise.reject(new Error('no window'))
          : Promise.resolve(undefined);
      },
    },
    hostPick: {pick: () => Promise.resolve(undefined)},
    filePick: {pick: () => Promise.resolve(undefined)},
  };
  const operations: EditorOperations = {
    reloadWindow: noted('reloadWindow'),
    closeRemote: noted('closeRemote'),
    openRecent: noted('openRecent'),
    openConfigFile: noted('openConfigFile'),
    openSetting: settingId => {
      calls.operations.push(`openSetting ${settingId}`);
      return Promise.resolve();
    },
    writeUserSetting: (settingId, value) => {
      calls.writes.push([settingId, value]);
      return Promise.resolve();
    },
    revealLog: () => {
      calls.operations.push('revealLog');
    },
  };
  const context: SurfaceContext = {
    settings: {
      inspectSetting: () => ({globalValue: changes.writtenPlatforms}),
    },
    configuredHosts: () => ({
      hosts: [{name: 'dev', file: '/h/.ssh/config'}],
    }),
    translate: template => template,
    help: {
      getHelp: {
        execute: () => {
          calls.operations.push('getHelp');
        },
      },
      settings: {
        execute: () => {
          calls.operations.push('settings');
        },
      },
    },
    names: {
      alias: () => 'dev',
      applicationName: 'Code - OSS',
      displayName: 'Remote - SSH',
    },
    acceptanceState: {
      get: key => changes.accepted?.[key],
      update: (key, value) => {
        calls.stored.push([key, value]);
        return Promise.resolve();
      },
    },
    noticeState: {get: () => undefined, update: () => Promise.resolve()},
    logger: createLogger(calls.logged, {minimumLevel: () => 'info'}),
    applyTerminalEnvironment: () => undefined,
    tunnels: {openTunnel: () => Promise.resolve({})},
  };
  return {surfaces: editorSurfacesOf(adapters, operations, context), calls};
}

const FAILED: Failed = {
  kind: 'unknown',
  retryable: false,
  silent: false,
  userAlreadyNotified: false,
  hints: [],
  diagnostics: [],
};

/** Lets the presenter's buttons, which act after it answers, run. */
function settled(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

/** The operations run after the failure dialog answers `answer` and "More Actions..." picks `mitigation`. */
async function afterDialog(
  answer: string | undefined,
  mitigation?: MitigationAction,
): Promise<string[]> {
  const {surfaces, calls} = surfacesWith({
    ...(answer === undefined ? {} : {dialogAnswer: answer}),
    ...(mitigation === undefined ? {} : {mitigation}),
  });
  await surfaces.presenter.present(FAILED);
  await settled();
  await settled();
  return calls.operations;
}

describe("the connect's surfaces over the editor", () => {
  it('F-2201 AC-22: the surfaces hand the connect the same reading the host pick uses', () => {
    const {surfaces} = surfacesWith();
    deepStrictEqual(surfaces.configuredHosts(), {
      hosts: [{name: 'dev', file: '/h/.ssh/config'}],
    });
  });

  it('F-2409 7.E1: a refused bind host is an error notice with no buttons that names the value', () => {
    const {surfaces, calls} = surfacesWith();
    surfaces.rejectBindHost('devbox', 'not a host!');
    deepStrictEqual(calls.errors, [
      ['not a host! is not a valid host to bind', []],
    ]);
  });

  it('F-2409 7.E1: a notice that cannot be shown is noted in the log, and the connect goes on', async () => {
    const {surfaces, calls} = surfacesWith({noticeFails: true});
    surfaces.rejectBindHost('devbox', '::1');
    await settled();
    deepStrictEqual(
      calls.logged.lines.map(line => line.message),
      ['the invalid bind host notice could not be shown: Error: no window'],
    );
  });

  it('F-2601: Retry reloads the window', async () => {
    deepStrictEqual(await afterDialog('Retry'), ['reloadWindow']);
  });

  it('F-2601: Close Remote leaves the remote', async () => {
    deepStrictEqual(await afterDialog('Close Remote'), ['closeRemote']);
  });

  it('F-2602 5.0 step 4: More Actions... then Reload Window reloads', async () => {
    deepStrictEqual(await afterDialog('More Actions...', 'reloadWindow'), [
      'reloadWindow',
    ]);
  });

  it('F-2602 5.0 step 4: Open Recent... opens the recent list', async () => {
    deepStrictEqual(await afterDialog('More Actions...', 'openRecent'), [
      'openRecent',
    ]);
  });

  it('F-2602 BR-5: Open Documentation runs the help command', async () => {
    deepStrictEqual(await afterDialog('More Actions...', 'openDocumentation'), [
      'getHelp',
    ]);
  });

  it('F-2602 5.0 step 4: Open SSH Configuration File runs its command', async () => {
    deepStrictEqual(await afterDialog('More Actions...', 'openConfigFile'), [
      'openConfigFile',
    ]);
  });

  it('F-2602 BR-10: Open Settings runs the settings command', async () => {
    deepStrictEqual(await afterDialog('More Actions...', 'openSettings'), [
      'settings',
    ]);
  });

  it('F-2602 AC-3: Escape on the dialog opens the picker, and Escape there does nothing', async () => {
    deepStrictEqual(await afterDialog(undefined), []);
  });

  it('F-3902 rule 8: the no-source dialog opens the download setting', async () => {
    const {surfaces, calls} = surfacesWith({dialogAnswer: 'Open Setting'});
    await surfaces.presenter.present({...FAILED, kind: 'noServerSource'});
    await settled();
    deepStrictEqual(calls.operations, [
      'openSetting remote.SSH.serverDownloadUrlTemplate',
    ]);
  });

  it('F-2206 5.2 step 3: the picked platform is given', async () => {
    const {surfaces} = surfacesWith({platform: 'windows'});
    deepStrictEqual(
      await surfaces.pickPlatform('dev', new AbortController().signal),
      'windows',
    );
  });

  it('F-2206 AC-9: a closed pick gives no platform', async () => {
    const {surfaces} = surfacesWith();
    deepStrictEqual(
      await surfaces.pickPlatform('dev', new AbortController().signal),
      undefined,
    );
  });

  it("F-2206 BR-6: the platform is added to the user's map, keeping its other entries", async () => {
    const {surfaces, calls} = surfacesWith({
      writtenPlatforms: {buildbox: 'macOS'},
    });
    await surfaces.writePlatform('devbox', 'linux');
    deepStrictEqual(calls.writes, [
      ['remote.SSH.remotePlatform', {buildbox: 'macOS', devbox: 'linux'}],
    ]);
  });

  it('F-2206 BR-6: a map that is not one starts empty', async () => {
    const {surfaces, calls} = surfacesWith({writtenPlatforms: ['linux']});
    await surfaces.writePlatform('devbox', 'linux');
    deepStrictEqual(calls.writes, [
      ['remote.SSH.remotePlatform', {devbox: 'linux'}],
    ]);
  });

  it('F-2206 BR-6: no map yet starts empty', async () => {
    const {surfaces, calls} = surfacesWith();
    await surfaces.writePlatform('devbox', 'macOS');
    deepStrictEqual(calls.writes, [
      ['remote.SSH.remotePlatform', {devbox: 'macOS'}],
    ]);
  });

  it('F-3902 AC-13: an acceptance is read from and kept in the profile state', async () => {
    const {surfaces, calls} = surfacesWith({accepted: {terms: true}});
    await surfaces.acceptances.accept('other');
    deepStrictEqual(
      [surfaces.acceptances.isAccepted('terms'), calls.stored],
      [true, [['other', true]]],
    );
  });

  it('F-2108 AC-11: the pre-connection record is kept in the profile state', async () => {
    const {surfaces, calls} = surfacesWith();
    await surfaces.preconnectApprovals.remember('/x.sh', 'abc');
    deepStrictEqual(calls.stored, [
      [
        `preconnectScriptConfirmed:${Buffer.from('/x.sh').toString('base64')}`,
        'abc',
      ],
    ]);
  });

  it('F-2108 AC-4: a dismissed pre-connection dialog skips the script', async () => {
    const {surfaces} = surfacesWith();
    deepStrictEqual(
      await surfaces.preconnectDialog.askUser(
        '/x.sh',
        false,
        new AbortController().signal,
      ),
      'skip',
    );
  });

  it('F-2304: the details link reveals the log', () => {
    const {surfaces, calls} = surfacesWith();
    surfaces.revealLog();
    deepStrictEqual(calls.operations, ['revealLog']);
  });

  it('F-3902 rule 11: a declined licence modal answers cancel', async () => {
    const {surfaces} = surfacesWith();
    deepStrictEqual(
      await surfaces.licenceModal.askUser(
        'https://example.invalid/terms',
        new AbortController().signal,
      ),
      'cancel',
    );
  });
});
