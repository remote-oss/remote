import {deepStrictEqual} from 'node:assert';
import type {WizardOutcome} from '../../src/authoring/wizard-stages.ts';
import {configurationAdded} from '../../src/volumes/volume-configuration.ts';

const WRITTEN: WizardOutcome = {
  kind: 'written',
  files: ['.devcontainer/devcontainer.json'],
  target: '/workspaces/r',
  place: 'workspace',
};

/** Runs the flow over wizard outcomes and S414 answers, in turn; what it returned and what it showed. */
async function flowOf(
  outcomes: WizardOutcome[],
  answers: boolean[],
): Promise<{result: string; shown: string[]}> {
  const shown: string[] = [];
  const result = await configurationAdded({
    runWizard: () => {
      shown.push('picker');
      return Promise.resolve(outcomes.shift() ?? WRITTEN);
    },
    mustSelect: () => {
      shown.push('S414');
      return Promise.resolve(answers.shift() ?? false);
    },
  });
  return {result, shown};
}

describe('a clone with no configuration (card containers-151)', () => {
  it('F-0701 6.1: a template written ends the flow at once', async () => {
    deepStrictEqual(await flowOf([WRITTEN], []), {
      result: 'written',
      shown: ['picker'],
    });
  });

  it('F-0701 7.E4, AC-9: leaving the picker shows S414; Select Configuration starts it again, and Cancel leaves', async () => {
    deepStrictEqual(
      [
        await flowOf([{kind: 'cancelled'}, WRITTEN], [true]),
        await flowOf([{kind: 'cancelled'}], [false]),
      ],
      [
        {result: 'written', shown: ['picker', 'S414', 'picker']},
        {result: 'left', shown: ['picker', 'S414']},
      ],
    );
  });

  it('a catalogue that can’t be read leaves at once: the wizard showed its own dialog', async () => {
    deepStrictEqual(await flowOf([{kind: 'failed', detail: 'offline'}], []), {
      result: 'left',
      shown: ['picker'],
    });
  });
});
