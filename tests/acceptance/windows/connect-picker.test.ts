import {deepStrictEqual} from 'node:assert';
import {copyFileSync, readFileSync, writeFileSync} from 'node:fs';
import {
  appendScript,
  closeWindow,
  hostAliases,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  recordLines,
  variable,
  waitFor,
  windowEvents,
  windowState,
  withoutActivity,
} from './harness.ts';

/** The pick of hosts' question. */
const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** The failing new window's entries: the dialog, then the pick of actions, both dismissed. */
function failureEntries(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

/** What a window shows of itself, with how many times its agent activated and deactivated. */
async function snapshot(name: string) {
  const state = withoutActivity(await windowState(name));
  const events = windowEvents(name).map(each => each.event);
  return {
    state,
    activated: events.filter(event => event === 'activated').length,
    deactivated: events.filter(event => event === 'deactivated').length,
  };
}

describe('Connect to Host... on the run’s configuration file (card coverage-18)', function () {
  this.timeout(300000);
  function configFile(): string {
    return variable('HARNESS_SSH_CONFIG');
  }
  function saved(): string {
    return `${configFile()}.saved`;
  }

  before(() => {
    copyFileSync(configFile(), saved());
  });

  after(async () => {
    copyFileSync(saved(), configFile());
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it('F-2202 AC-31: a listed host that ssh cannot resolve opens a window whose dialog says so, and the picking window is unchanged', async () => {
    const before = await snapshot('local');
    const next = nextEmptyName();
    appendScript([
      {
        surface: 'hostPick',
        match: HOST_QUESTION,
        answer: {label: 'nowhere'},
        window: 'local',
      },
      ...failureEntries(next),
    ]);
    const name = await nextEmptyWindow(() =>
      inWindow('local', 'opensshremotes.openEmptyWindow'),
    );
    await waitFor(
      'the dialog of the new window',
      () => recordLines('failureDialog', name).length > 0,
      60_000,
    );
    deepStrictEqual(
      [
        recordLines('failureDialog', name)[0]?.question,
        await snapshot('local'),
      ],
      [
        'Could not establish connection to "nowhere": Could not resolve hostname.',
        before,
      ],
    );
    await closeWindow(name);
  });

  it('F-2202 AC-22, F-2201 AC-17: a host added to the file while the picker is closed is in the next pick in its place, with no reload', async () => {
    const before = await snapshot('local');
    writeFileSync(
      configFile(),
      `${readFileSync(saved(), 'utf8')}\nHost fresh-alias\n  HostName 127.0.0.1\n`,
    );
    appendScript([
      {
        surface: 'hostPick',
        match: HOST_QUESTION,
        answer: 'dismiss',
        window: 'local',
      },
    ]);
    await inWindow('local', 'opensshremotes.openEmptyWindow');
    deepStrictEqual(
      [
        recordLines('hostPick', 'local').at(-1)?.items?.slice(0, -2),
        await snapshot('local'),
      ],
      [hostAliases(), before],
    );
  });

  it('F-2201 AC-21: a file with an unterminated quote does not stop the configuration file pick from opening', async () => {
    writeFileSync(
      configFile(),
      `${readFileSync(saved(), 'utf8')}\nHost "broken\n  HostName 127.0.0.1\n`,
    );
    appendScript([
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: 'dismiss',
        window: 'local',
      },
    ]);
    await inWindow('local', 'opensshremotes.openConfigFile');
    deepStrictEqual(
      recordLines('filePick', 'local')
        .slice(-1)
        .map(line => line.question),
      ['Edit custom SSH configuration file'],
    );
  });
});
