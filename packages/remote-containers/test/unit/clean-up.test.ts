import {deepStrictEqual} from 'node:assert';
import {
  type CleanUpPorts,
  cleanUpDevContainers,
  pruneVolumes,
} from '../../src/explorer/clean-up.ts';
import type {CleanUpRow} from '../../src/explorer/clean-up-scans.ts';

const TEXTS = {
  containersPlaceholder: 'containers?',
  volumesPlaceholder: 'volumes?',
  nothingLeft: 'done',
  noUnusedVolumes: 'no volumes',
};

/** What the scenario does on each step. */
interface Scenario {
  containers?: CleanUpRow[] | Error;
  /** The volume scans in order; the last repeats. */
  volumes?: Array<CleanUpRow[] | Error>;
  /** The answers to the pickers in order: the targets to check, or none for Escape. */
  picks?: Array<string[] | undefined>;
  failRemoval?: 'containers' | 'volumes';
}

/** Runs `command` over a scenario and gives what it did in order, and how it ended. */
async function outcomeOf(
  command: (ports: CleanUpPorts) => Promise<void>,
  scenario: Scenario,
): Promise<{steps: string[]; ended: string}> {
  const steps: string[] = [];
  const scans = [...(scenario.volumes ?? [[]])];
  const picks = [...(scenario.picks ?? [])];
  const ports: CleanUpPorts = {
    scanContainers: () => {
      steps.push('scan containers');
      const rows = scenario.containers ?? [];
      return rows instanceof Error
        ? Promise.reject(rows)
        : Promise.resolve(rows);
    },
    scanVolumes: () => {
      steps.push('scan volumes');
      const rows = scans.length > 1 ? scans.shift() : scans[0];
      return rows instanceof Error
        ? Promise.reject(rows)
        : Promise.resolve(rows ?? []);
    },
    pick: (placeholder, rows) => {
      steps.push(
        `pick ${placeholder} ${rows.map(entry => entry.target).join(',')}`,
      );
      const targets = picks.shift();
      return Promise.resolve(
        targets === undefined
          ? undefined
          : rows.filter(entry => targets.includes(entry.target)),
      );
    },
    removeContainers: identifiers => {
      steps.push(`rm ${identifiers.join(',')}`);
      return scenario.failRemoval === 'containers'
        ? Promise.reject(new Error('gone'))
        : Promise.resolve();
    },
    removeVolumes: names => {
      steps.push(`volume rm ${names.join(',')}`);
      return scenario.failRemoval === 'volumes'
        ? Promise.reject(new Error('gone'))
        : Promise.resolve();
    },
    complete: text => {
      steps.push(`dialog ${text}`);
      return Promise.resolve();
    },
    texts: TEXTS,
    report: line => {
      steps.push(`log ${line}`);
    },
  };
  let ended = 'resolved';
  await command(ports).catch((caught: unknown) => {
    ended = `rejected ${caught instanceof Error ? caught.message : String(caught)}`;
  });
  return {steps, ended};
}

const CONTAINERS: CleanUpRow[] = [
  {label: 'one', target: 'c1'},
  {label: 'two', target: 'c2'},
  {label: 'two', target: 'c2'},
];
const VOLUMES: CleanUpRow[] = [{label: 'v', target: 'v1'}];

describe('Clean Up Dev Containers (card containers-168)', () => {
  it('F-0905 AC-1, AC-3, BR-4: the containers picker removes the checked ones in one command, each once, then the dialog when no volume is unused', async () => {
    deepStrictEqual(
      await outcomeOf(cleanUpDevContainers, {
        containers: CONTAINERS,
        picks: [['c1', 'c2']],
      }),
      {
        steps: [
          'scan containers',
          'pick containers? c1,c2,c2',
          'rm c1,c2',
          'scan volumes',
          'dialog done',
        ],
        ended: 'resolved',
      },
    );
  });

  it('F-0905 AC-2: Escape on the containers picker closes it with no removal, no scan and no dialog', async () => {
    deepStrictEqual(
      await outcomeOf(cleanUpDevContainers, {
        containers: CONTAINERS,
        picks: [undefined],
      }),
      {
        steps: ['scan containers', 'pick containers? c1,c2,c2'],
        ended: 'resolved',
      },
    );
  });

  it('F-0905 AC-20: with an unused volume found after OK, whether or not a container was checked, the volumes picker follows and removes the checked ones with no dialog', async () => {
    deepStrictEqual(
      await outcomeOf(cleanUpDevContainers, {
        containers: CONTAINERS,
        volumes: [VOLUMES],
        picks: [[], ['v1']],
      }),
      {
        steps: [
          'scan containers',
          'pick containers? c1,c2,c2',
          'scan volumes',
          'pick volumes? v1',
          'volume rm v1',
        ],
        ended: 'resolved',
      },
    );
  });

  it('F-0905 AC-2: Escape on the chained volumes picker removes nothing and shows no dialog', async () => {
    deepStrictEqual(
      (
        await outcomeOf(cleanUpDevContainers, {
          containers: CONTAINERS,
          volumes: [VOLUMES],
          picks: [['c1'], undefined],
        })
      ).steps.slice(-2),
      ['scan volumes', 'pick volumes? v1'],
    );
  });

  it('F-0905 AC-6: with no stopped container and an unused volume the volumes picker comes first, and its OK ends with the dialog', async () => {
    deepStrictEqual(
      await outcomeOf(cleanUpDevContainers, {
        volumes: [VOLUMES],
        picks: [['v1']],
      }),
      {
        steps: [
          'scan containers',
          'scan volumes',
          'pick volumes? v1',
          'volume rm v1',
          'dialog done',
        ],
        ended: 'resolved',
      },
    );
  });

  it('F-0905 AC-25: Escape on that only picker still ends with the dialog, with the volume untouched', async () => {
    deepStrictEqual(
      await outcomeOf(cleanUpDevContainers, {
        volumes: [VOLUMES],
        picks: [undefined],
      }),
      {
        steps: [
          'scan containers',
          'scan volumes',
          'pick volumes? v1',
          'dialog done',
        ],
        ended: 'resolved',
      },
    );
  });

  it('F-0905 AC-7: with nothing to offer the dialog shows at once, with no picker', async () => {
    deepStrictEqual(await outcomeOf(cleanUpDevContainers, {}), {
      steps: ['scan containers', 'scan volumes', 'dialog done'],
      ended: 'resolved',
    });
  });

  it('F-0905 AC-11, AC-21, BR-16: a removal that fails ends the command with that error, and no volumes scan, picker or dialog follows', async () => {
    deepStrictEqual(
      await outcomeOf(cleanUpDevContainers, {
        containers: CONTAINERS,
        volumes: [VOLUMES],
        picks: [['c1']],
        failRemoval: 'containers',
      }),
      {
        steps: ['scan containers', 'pick containers? c1,c2,c2', 'rm c1'],
        ended: 'rejected gone',
      },
    );
  });

  it('F-0905 AC-19: an engine that cannot be asked rejects the command, so that core shows its error dialog', async () => {
    deepStrictEqual(
      await outcomeOf(cleanUpDevContainers, {
        containers: new Error('no engine'),
      }),
      {steps: ['scan containers'], ended: 'rejected no engine'},
    );
  });
});

describe('Clean Up Dev Volumes (card containers-168)', () => {
  it('F-0905 AC-5: the volumes picker removes the checked volumes and closes with no dialog, and an OK with none checked removes nothing', async () => {
    deepStrictEqual(
      [
        await outcomeOf(pruneVolumes, {volumes: [VOLUMES], picks: [['v1']]}),
        await outcomeOf(pruneVolumes, {volumes: [VOLUMES], picks: [[]]}),
      ],
      [
        {
          steps: ['scan volumes', 'pick volumes? v1', 'volume rm v1'],
          ended: 'resolved',
        },
        {steps: ['scan volumes', 'pick volumes? v1'], ended: 'resolved'},
      ],
    );
  });

  it('F-0905 AC-2: Escape on the picker removes nothing and shows no dialog', async () => {
    deepStrictEqual(
      await outcomeOf(pruneVolumes, {volumes: [VOLUMES], picks: [undefined]}),
      {steps: ['scan volumes', 'pick volumes? v1'], ended: 'resolved'},
    );
  });

  it('F-0905 AC-8, AC-14: with no unused volume the dialog says so at once, with no picker', async () => {
    deepStrictEqual(await outcomeOf(pruneVolumes, {}), {
      steps: ['scan volumes', 'dialog no volumes'],
      ended: 'resolved',
    });
  });

  it('F-0905 AC-19: an engine that cannot be asked is logged, and nothing is shown', async () => {
    deepStrictEqual(
      await outcomeOf(pruneVolumes, {volumes: [new Error('no engine')]}),
      {
        steps: [
          'scan volumes',
          'log the unused volumes could not be listed: no engine',
        ],
        ended: 'resolved',
      },
    );
  });

  it('F-0905 AC-11: a removal that fails rejects with its error', async () => {
    deepStrictEqual(
      await outcomeOf(pruneVolumes, {
        volumes: [VOLUMES],
        picks: [['v1']],
        failRemoval: 'volumes',
      }),
      {
        steps: ['scan volumes', 'pick volumes? v1', 'volume rm v1'],
        ended: 'rejected gone',
      },
    );
  });
});
