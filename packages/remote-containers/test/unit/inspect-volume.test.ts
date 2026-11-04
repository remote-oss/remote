import {deepStrictEqual} from 'node:assert';
import {
  compareVolumeNames,
  INSPECT_FOLDER,
  type InspectRow,
  inspectRowsOf,
  inspectTargetOf,
  inspectVolume,
  type InspectVolumePorts,
  inspectWindowUriOf,
} from '../../src/volumes/inspect-volume.ts';
import {volumeTargetOf} from '../../src/volumes/volume-payload.ts';

describe('the volumes Explore a Volume offers (card containers-155)', () => {
  it('F-0705 AC-2: names sort with digit runs by value and other characters by code: vol-2 before vol-10, upper case before lower case, - before . before _', () => {
    deepStrictEqual(
      [
        'vol-10',
        'vol_a',
        'vol.a',
        'vol-2',
        'Vol-a',
        'vol-a',
        'a',
        'a1',
        'vol-3',
        'vol-3',
        'vol-007',
        'vol-7x',
      ].sort(compareVolumeNames),
      [
        'Vol-a',
        'a',
        'a1',
        'vol-2',
        'vol-3',
        'vol-3',
        'vol-007',
        'vol-7x',
        'vol-10',
        'vol-a',
        'vol.a',
        'vol_a',
      ],
    );
  });

  it('F-0705 AC-2: an empty name sorts before any other, and equal to itself', () => {
    deepStrictEqual(
      [
        compareVolumeNames('', 'a'),
        compareVolumeNames('a', ''),
        compareVolumeNames('', ''),
      ],
      [-1, 1, 0],
    );
  });

  it('F-0705 AC-2, AC-35: every volume is a row with a folder icon, and the creation date in English whatever the locale, none for a volume the engine gave no time', () => {
    const created = new Date(2026, 9, 2, 12, 0, 0).getTime();
    deepStrictEqual(
      inspectRowsOf(
        [
          {name: 'b', labels: {}, createdAt: created},
          {name: 'a', labels: {'vsch.local.repository': 'x'}},
        ],
        date => `created at ${date}`,
      ),
      [
        {label: '$(folder) a', volumeName: 'a'},
        {
          label: '$(folder) b',
          description: 'created at Fri Oct 02 2026',
          volumeName: 'b',
        },
      ],
    );
  });

  it('F-0705 AC-3: no volume gives no row', () => {
    deepStrictEqual(
      inspectRowsOf([], date => date),
      [],
    );
  });

  it('F-0705 5.0: the window of a picked volume is the volume payload with only its name and the explore mark, at the folder volume', () => {
    const target = inspectTargetOf('data', {});
    const address = inspectWindowUriOf(target);
    const payload = address.slice(
      'vscode-remote://dev-container+'.length,
      -`/${INSPECT_FOLDER}`.length,
    );
    deepStrictEqual(
      [address.endsWith('/volume'), volumeTargetOf(payload), target],
      [
        true,
        target,
        {
          kind: 'volume',
          repositoryPath: '',
          volumeName: 'data',
          folder: 'volume',
          inspectVolume: true,
        },
      ],
    );
  });
});

/** What the ports of a scenario answer. */
interface Scenario {
  ready?: boolean;
  listing?: unknown;
  /** The volume the user picks; none for a picker that closes without a pick. */
  pick?: string;
}

/** Runs the command over ports that answer as the scenario says, and gives what it did in order. */
async function stepsOf(scenario: Scenario = {}): Promise<string[]> {
  const steps: string[] = [];
  const ports: InspectVolumePorts = {
    engineReady: () => {
      steps.push('check');
      return Promise.resolve(scenario.ready ?? true);
    },
    volumes: () => {
      steps.push('list');
      return scenario.listing === undefined
        ? Promise.resolve([
            {name: 'one', labels: {}},
            {name: 'two', labels: {}},
          ])
        : Promise.reject(scenario.listing);
    },
    pick: rows => {
      steps.push(`pick ${rows.map(entry => entry.volumeName).join(',')}`);
      const chosen: InspectRow | undefined = rows.find(
        entry => entry.volumeName === scenario.pick,
      );
      return Promise.resolve(chosen);
    },
    createdAt: date => `created at ${date}`,
    engine: () => ({}),
    reload: address => {
      steps.push(`reload ${String(address.endsWith('/volume'))}`);
      return Promise.resolve();
    },
    report: line => {
      steps.push(`log ${line}`);
    },
  };
  await inspectVolume(ports);
  return steps;
}

describe('Explore a Volume in a Dev Container (card containers-155)', () => {
  it('F-0705 AC-1, AC-5: with the engine ready the picker lists the volumes and the picked one opens its window in this one', async () => {
    deepStrictEqual(await stepsOf({pick: 'two'}), [
      'check',
      'list',
      'pick one,two',
      'reload true',
    ]);
  });

  it('F-0705 AC-4, AC-33: a picker that closes without a pick changes nothing', async () => {
    deepStrictEqual(await stepsOf(), ['check', 'list', 'pick one,two']);
  });

  it('F-0705 AC-16, AC-24: an engine that is not ready ends the command before any listing, and shows nothing of ours', async () => {
    deepStrictEqual(await stepsOf({ready: false}), ['check']);
  });

  it('F-0705 AC-3, AC-36: a listing that fails is logged, with a text that is not an error too, and shows no picker', async () => {
    deepStrictEqual(
      [
        await stepsOf({listing: new Error('no daemon')}),
        await stepsOf({listing: 'plain text'}),
      ],
      [
        ['check', 'list', 'log the volumes could not be listed: no daemon'],
        ['check', 'list', 'log the volumes could not be listed: plain text'],
      ],
    );
  });
});
