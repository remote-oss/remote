import {deepStrictEqual} from 'node:assert';
import {
  explainedFailure,
  section,
  settledSection,
} from '../tests/acceptance/windows/connect-failure.ts';

describe('the failure of a wait for a connect and its explanation (card #2490)', () => {
  it("#2490: the explanation follows the wait's own failure, which stays the cause", async () => {
    const waited = new Error('timed out waiting for a2 to be connected');
    const failure = await explainedFailure(waited, () =>
      Promise.resolve("the host's listeners:\nnone"),
    );
    deepStrictEqual(
      [failure.message, failure.cause === waited],
      [
        "Error: timed out waiting for a2 to be connected\nthe host's listeners:\nnone",
        true,
      ],
    );
  });

  it("#2490: an explanation that fails is told in its place, and the wait's own failure stays first and the cause", async () => {
    const waited = new Error('timed out waiting for a2 to be connected');
    const failure = await explainedFailure(waited, () =>
      Promise.reject(new Error('no REMOTE_OSS_ACCEPTANCE_RECORD')),
    );
    deepStrictEqual(
      [failure.message, failure.cause === waited],
      [
        'Error: timed out waiting for a2 to be connected\n(the explanation could not be read: Error: no REMOTE_OSS_ACCEPTANCE_RECORD)',
        true,
      ],
    );
  });

  it('#2490: a section gives its title and its text, or why it could not be read', () => {
    deepStrictEqual(
      [
        section('what a2 recorded', () => 'progress: Setting up SSH Host'),
        section('what a2 recorded', () => {
          throw new Error('ENOENT: record.jsonl');
        }),
      ],
      [
        'what a2 recorded:\nprogress: Setting up SSH Host',
        'what a2 recorded:\n(unreadable: Error: ENOENT: record.jsonl)',
      ],
    );
  });

  it('#2753: a section read in time gives its title and its text, or why it could not be read', async () => {
    deepStrictEqual(
      [
        await settledSection('the indicator', () =>
          Promise.resolve('Reconnecting'),
        ),
        await settledSection('the indicator', () =>
          Promise.reject(new Error('window closed')),
        ),
      ],
      [
        'the indicator:\nReconnecting',
        'the indicator:\n(unreadable: Error: window closed)',
      ],
    );
  });
});
