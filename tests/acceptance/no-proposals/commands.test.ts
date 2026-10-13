import {deepStrictEqual, strictEqual} from 'node:assert';
import {connectionLog, inWindow, recordLines} from '../windows/harness.ts';

/** What running a command in the local window gave: it finished, or it failed with this message. */
async function outcomeOf(
  command: string,
  ...parameters: unknown[]
): Promise<string> {
  try {
    await inWindow('local', command, ...parameters);
    return 'done';
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

/** Polls until the record holds a `notice` line of the local window, for up to a minute, and gives those lines. */
async function setupNotices(): Promise<ReturnType<typeof recordLines>> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const notices = recordLines('notice', 'local');
    if (notices.length > 0) {
      return notices;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return [];
}

describe('the commands of an editor that does not enable the proposed API (card connect-30)', function () {
  this.timeout(180000);

  it('contracts §3.2: F-3903 §5 rule 4, without the proposal Connect to Host is a command, not "not found"', async () => {
    strictEqual(
      (
        await outcomeOf('opensshremotes.openEmptyWindow', {host: 'harness'})
      ).includes('not found'),
      false,
    );
  });

  it('contracts §3.2: F-3903 §5 rule 4, without the proposals the setup notice is shown once, in the words of F-2001 §3.4', async () => {
    await inWindow('local', 'opensshremotes.showLog');
    const notices = await setupNotices();
    strictEqual(
      notices.length === 1 &&
        /^Remote - SSH needs proposed VS Code APIs that .+ has not enabled for it\. Add .+ to 'enable-proposed-api' in argv\.json, then restart .+\.$/.test(
          notices[0]?.question ?? '',
        ),
      true,
    );
  });

  it('contracts §3.2: F-3903 §5 rule 4, without the proposals the setup notice offers Configure Runtime Arguments and Not Now', async () => {
    const notices = await setupNotices();
    deepStrictEqual(
      notices.map(notice => notice.buttons),
      [['Configure Runtime Arguments', 'Not Now']],
    );
  });

  it('contracts §3.2: F-3903 §5 rule 4, without the proposals the log names them', () => {
    deepStrictEqual(
      connectionLog().filter(line => line.startsWith('Missing proposed APIs')),
      ['Missing proposed APIs: resolvers, tunnels, terminalDataWriteEvent'],
    );
  });

  it('contracts §3.2: F-3903 §5 rule 4, a second command in the same window shows nothing more', async () => {
    await inWindow('local', 'opensshremotes.showLog');
    strictEqual(recordLines('notice', 'local').length, 1);
  });
});
