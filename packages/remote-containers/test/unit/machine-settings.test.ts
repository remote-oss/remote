import {deepStrictEqual} from 'node:assert';
import {type ChannelFailure} from 'lib-host';
import {
  RecordingChannel,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {
  machineSettingsText,
  writeMachineSettings,
} from '../../src/settings/machine-settings.ts';

const NEVER = new AbortController().signal;

const FOLDER = '/home/node/.vscodium-server';
const FILE = `${FOLDER}/data/Machine/settings.json`;

/** An answer to the reading script, which prints the file's base64 as one line, or nothing for a missing file. */
function reading(text: string | undefined, status = 0): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: script => script.includes('base64 <'),
    lines: text === undefined ? [] : [Buffer.from(text).toString('base64')],
    ending: {kind: 'exit', status},
  };
}

/** An answer to the writing script. */
function writing(status = 0): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: script => script.includes('cat > '),
    lines: [],
    ending: {kind: 'exit', status},
  };
}

function channelOf(...scripts: ScriptAnswer[]): RecordingChannel {
  return new RecordingChannel({identity: 'c1', platformHint: 'linux', scripts});
}

/** The scripts the channel runs, and the text the writing script was given. */
function ranOf(channel: RecordingChannel): {
  scripts: string[];
  texts: string[];
} {
  const requests = channel.calls.flatMap(call =>
    call.operation === 'runScript' ? [call.request] : [],
  );
  return {
    scripts: requests.map(request => request.script),
    texts: requests.map(request =>
      request.input.kind === 'text' ? request.input.text : '',
    ),
  };
}

const SETTINGS = {'remote.portsAttributes': {'3000': {label: 'App'}}};

describe('the machine settings text (card containers-73)', () => {
  it('F-1101 BR-23: an empty file gets an object with the keys', () => {
    deepStrictEqual(JSON.parse(machineSettingsText('', SETTINGS)), SETTINGS);
  });

  it('F-1101 BR-23: other keys and comments stay, and a key already there is replaced', () => {
    const text = machineSettingsText(
      '{\n  // keep\n  "editor.tabSize": 2,\n  "remote.portsAttributes": {"1": {}}\n}\n',
      SETTINGS,
    );
    deepStrictEqual(
      [text.includes('// keep'), JSON.parse(text.replace('// keep', ''))],
      [true, {'editor.tabSize': 2, ...SETTINGS}],
    );
  });

  it('F-1101 BR-23: no settings leave the text as it is', () => {
    deepStrictEqual(machineSettingsText('{ "a": 1 }', {}), '{ "a": 1 }');
  });
});

describe('the machine settings write (card containers-73)', () => {
  it('F-1101 BR-23: with no settings no script runs', async () => {
    const channel = channelOf();
    deepStrictEqual(
      [
        await writeMachineSettings(channel, FOLDER, {}, NEVER),
        channel.calls.length,
      ],
      [{kind: 'unchanged'}, 0],
    );
  });

  it('F-1101 BR-23: a missing file is read as empty and written in the data folder, atomically', async () => {
    const channel = channelOf(reading(undefined), writing());
    const outcome = await writeMachineSettings(
      channel,
      FOLDER,
      SETTINGS,
      NEVER,
    );
    const runs = ranOf(channel);
    deepStrictEqual(
      [
        outcome,
        runs.scripts[0]?.includes(`'${FILE}'`),
        runs.scripts[1]?.includes(`mv -f '${FILE}.part' '${FILE}'`),
        runs.scripts[1]?.includes(`mkdir -p '${FOLDER}/data/Machine'`),
        JSON.parse(runs.texts[1] ?? ''),
      ],
      [{kind: 'written'}, true, true, true, SETTINGS],
    );
  });

  it('F-1101 BR-23: a file that already holds the keys is not written again', async () => {
    const channel = channelOf(reading(machineSettingsText('', SETTINGS)));
    deepStrictEqual(
      [
        await writeMachineSettings(channel, FOLDER, SETTINGS, NEVER),
        channel.calls.length,
      ],
      [{kind: 'unchanged'}, 1],
    );
  });

  it('F-1101 BR-23: a reading that ends with a failing status is a failure, and nothing is written', async () => {
    const channel = channelOf(reading(undefined, 3));
    deepStrictEqual(
      [
        await writeMachineSettings(channel, FOLDER, SETTINGS, NEVER),
        channel.calls.length,
      ],
      [{kind: 'failed', detail: 'settings file not read (exit 3)'}, 1],
    );
  });

  it('F-1101 BR-23: a writing that ends with a failing status is a failure', async () => {
    const channel = channelOf(reading(undefined), writing(1));
    deepStrictEqual(
      await writeMachineSettings(channel, FOLDER, SETTINGS, NEVER),
      {kind: 'failed', detail: 'settings file not written (exit 1)'},
    );
  });

  it('F-1101 BR-23: a channel that fails on the reading or on the writing gives its detail', async () => {
    const failure: ChannelFailure = {kind: 'spawnFailed', detail: 'no exec'};
    function failing(matches: (script: string) => boolean): ScriptAnswer {
      return {
        interpreter: 'posixShell',
        matches,
        lines: [],
        ending: {kind: 'fail', failure},
      };
    }
    const readFails = await writeMachineSettings(
      channelOf(failing(script => script.includes('base64 <'))),
      FOLDER,
      SETTINGS,
      NEVER,
    );
    const writeFails = await writeMachineSettings(
      channelOf(
        reading(undefined),
        failing(script => script.includes('cat > ')),
      ),
      FOLDER,
      SETTINGS,
      NEVER,
    );
    deepStrictEqual(
      [readFails, writeFails],
      [
        {kind: 'failed', detail: 'no exec'},
        {kind: 'failed', detail: 'no exec'},
      ],
    );
  });
});
