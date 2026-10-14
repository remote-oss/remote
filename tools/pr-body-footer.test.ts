import {strictEqual} from 'node:assert';
import {withoutFooter} from './pr-body-footer.ts';

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
});
