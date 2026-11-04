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
      ['vol-10', 'vol_a', 'vol.a', 'vol-2', 'Vol-a', 'vol-a', 'a', 'a1'].sort(
        compareVolumeNames,
      ),
      ['Vol-a', 'a', 'a1', 'vol-2', 'vol-10', 'vol-a', 'vol.a', 'vol_a'],
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
      [address.endsWith('/volume'), volumeTargetOf(payload)],
      [true, target],
    );
    deepStrictEqual(target, {
      kind: 'volume',
      repositoryPath: '',
      volumeName: 'data',
      folder: 'volume',
      inspectVolume: true,
    });
  });
});

/** Runs the command over ports that answer as the scenario says, and gives what it did in order. */
async function run(
  scenario: {
    ready?: boolean;
    listing?: Error;
    pick?: 'dismiss' | string;
  } = {},
): Promise<string[]> {
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
      steps.push(`reload ${address.endsWith('/volume')}`);
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
    deepStrictEqual(await run({pick: 'two'}), [
      'check',
      'list',
      'pick one,two',
      'reload true',
    ]);
  });

  it('F-0705 AC-4, AC-33: a picker that closes without a pick changes nothing', async () => {
    deepStrictEqual(await run({pick: 'dismiss'}), [
      'check',
      'list',
      'pick one,two',
    ]);
  });

  it('F-0705 AC-16, AC-24: an engine that is not ready ends the command before any listing, and shows nothing of ours', async () => {
    deepStrictEqual(await run({ready: false}), ['check']);
  });

  it('F-0705 AC-3, AC-36: no volume gives a picker with no row, shown after the listing', async () => {
    const steps: string[] = [];
    await inspectVolume({
      engineReady: () => Promise.resolve(true),
      volumes: () => {
        steps.push('list');
        return Promise.resolve([]);
      },
      pick: rows => {
        steps.push(`pick ${String(rows.length)}`);
        return Promise.resolve(undefined);
      },
      createdAt: date => date,
      engine: () => ({}),
      reload: () => Promise.resolve(),
      report: () => undefined,
    });
    deepStrictEqual(steps, ['list', 'pick 0']);
  });

  it('F-0705 7.E3: a listing that fails is logged and shows no picker', async () => {
    deepStrictEqual(await run({listing: new Error('no daemon')}), [
      'check',
      'list',
      'log the volumes could not be listed: no daemon',
    ]);
  });
});
