import {deepStrictEqual, strictEqual} from 'node:assert';
import {stripFooter, withoutFooter} from './pr-body-footer.ts';

describe('pr-body-footer', () => {
  it('removes the three footer forms and the blank lines they leave', () => {
    strictEqual(
      withoutFooter(
        [
          'Fixes #1.',
          '',
          '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
          '',
          'https://claude.ai/code/session_01AbC',
          '🤖 Generated with [Claude Code](https://claude.ai/code/session_01AbC)',
          '',
        ].join('\n'),
      ),
      'Fixes #1.',
    );
  });

  it('keeps a sentence that mentions claude.com in the middle of a line', () => {
    strictEqual(
      withoutFooter('See https://claude.com/claude-code for the CLI.'),
      undefined,
    );
  });

  it('leaves a body with no footer alone', () => {
    strictEqual(withoutFooter('Fixes #2.\n\nNotes.'), undefined);
  });

  it('edits the body as it is now, not as the event saw it', async () => {
    const calls = recording(
      'Fixes #3.\n\nAdded after the event.\n\nhttps://claude.ai/code/session_01AbC',
    );
    deepStrictEqual(
      {result: await stripFooter('u', 't', calls.request), sent: calls.sent},
      {
        result: 'footer removed',
        sent: [
          'GET',
          `PATCH ${JSON.stringify({body: 'Fixes #3.\n\nAdded after the event.'})}`,
        ],
      },
    );
  });

  it('makes no edit when the current body has no footer', async () => {
    const calls = recording('Fixes #4.');
    deepStrictEqual(
      {result: await stripFooter('u', 't', calls.request), sent: calls.sent},
      {result: 'no footer', sent: ['GET']},
    );
  });
});

/** A stand-in for fetch that answers every request with `body` and records each request's method and payload. */
function recording(body: string): {
  request: (url: string, init?: RequestInit) => Promise<Response>;
  sent: string[];
} {
  const sent: string[] = [];
  function request(url: string, init?: RequestInit): Promise<Response> {
    const payload = typeof init?.body === 'string' ? ` ${init.body}` : '';
    sent.push(`${init?.method ?? 'GET'}${payload}`);
    return Promise.resolve(Response.json({body, url}));
  }
  return {request, sent};
}
