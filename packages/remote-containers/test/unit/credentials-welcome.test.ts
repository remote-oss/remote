import {deepStrictEqual} from 'node:assert';
import {
  failureWelcomeOf,
  type ShownBefore,
} from '../../src/explorer/credentials-welcome.ts';
import {operationOf} from '../../src/engine/ssh-questions.ts';

/** The outcome of a listing whose questions did `changes`. */
function outcomeOf(
  changes: Partial<ReturnType<typeof operationOf>['outcome']>,
) {
  return {...operationOf('view', 'ssh://host').outcome, ...changes};
}

describe('the welcome of a listing that failed on an SSH endpoint (card containers-172, §4)', () => {
  it('F-0901 BR-20 (a): a box answered or dismissed during the listing gives the generic welcome, whatever else happened', () => {
    deepStrictEqual(
      (['view', 'automatic', 'command'] as const).map(mode =>
        failureWelcomeOf(
          mode,
          outcomeOf({boxClosed: true, refused: true, replayed: true}),
          'needsSSHCredentials',
        ),
      ),
      Array(3).fill('needsDockerStartOrInstall'),
    );
  });

  it('F-0901 BR-20 (c), AC-27, AC-47: an automatic listing with a question refused, for lack of an answer or by a remembered decline, asks for credentials', () => {
    deepStrictEqual(
      [
        failureWelcomeOf('automatic', outcomeOf({refused: true}), 'listing'),
        failureWelcomeOf(
          'automatic',
          outcomeOf({refused: true, declinedApplied: true}),
          'listing',
        ),
        failureWelcomeOf('automatic', outcomeOf({}), 'listing'),
      ],
      [
        'needsSSHCredentials',
        'needsSSHCredentials',
        'needsDockerStartOrInstall',
      ],
    );
  });

  it('F-0901 BR-20 (d), AC-46, AC-55: a remembered answer replayed with the listing still failing asks for credentials, in any mode', () => {
    deepStrictEqual(
      (['view', 'automatic', 'command'] as const).map(mode =>
        failureWelcomeOf(mode, outcomeOf({replayed: true}), 'listing'),
      ),
      Array(3).fill('needsSSHCredentials'),
    );
  });

  it('F-0901 BR-20 (b), AC-26: a view listing with a remembered decline keeps the welcome shown before, and the generic one after rows', () => {
    const declined = outcomeOf({declinedApplied: true, refused: true});
    function keeps(before: ShownBefore) {
      return failureWelcomeOf('view', declined, before);
    }
    deepStrictEqual(
      [
        keeps('needsSSHCredentials'),
        keeps('needsDockerStartOrInstall'),
        keeps('listing'),
      ],
      [
        'needsSSHCredentials',
        'needsDockerStartOrInstall',
        'needsDockerStartOrInstall',
      ],
    );
  });

  it('F-0901 BR-20: with no question at all the welcome is the generic one', () => {
    deepStrictEqual(
      (['view', 'automatic', 'command'] as const).map(mode =>
        failureWelcomeOf(mode, outcomeOf({}), 'needsSSHCredentials'),
      ),
      Array(3).fill('needsDockerStartOrInstall'),
    );
  });
});
