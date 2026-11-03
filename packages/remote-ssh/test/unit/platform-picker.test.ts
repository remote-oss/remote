import {deepStrictEqual} from 'node:assert';
import {
  type PlatformPick,
  type PlatformPickPort,
  pickRemotePlatform,
  platformPickOf,
} from '../../src/connect/platform-picker.ts';
import type {RemotePlatform} from '../../src/pipeline/platform.ts';

/** A port that records what it was given and answers from a script. */
function portAnswering(answer: RemotePlatform | undefined) {
  const shown: PlatformPick[] = [];
  const signals: AbortSignal[] = [];
  const port: PlatformPickPort = {
    pick: (pick, cancellation) => {
      shown.push(pick);
      signals.push(cancellation);
      return Promise.resolve(answer);
    },
  };
  return {port, shown, signals};
}

describe('the platform picker (F-2206)', () => {
  it('F-2603 AC-19: after a broken pipe the placeholder is the error wording naming the host, and differs from the ordinary one', () => {
    deepStrictEqual(
      [
        platformPickOf('my-server', 'brokenPipe').placeholder,
        platformPickOf('my-server', 'ask').placeholder.id,
      ],
      [
        {id: 'platformPickAfterBrokenPipe', values: ['my-server']},
        'platformPickPlaceholder',
      ],
    );
  });

  it('F-2603 AC-19: both variants show the same items and focus Linux', () => {
    const asking = platformPickOf('box', 'ask');
    const broken = platformPickOf('box', 'brokenPipe');
    deepStrictEqual(
      [broken.items, broken.active],
      [asking.items, asking.active],
    );
  });

  it('F-2206 AC-2: the placeholder names the host', () => {
    deepStrictEqual(platformPickOf('box', 'ask').placeholder, {
      id: 'platformPickPlaceholder',
      values: ['box'],
    });
  });

  it('F-2206 AC-2: Linux is the focused one', () => {
    deepStrictEqual(platformPickOf('box', 'ask').active, 'linux');
  });

  it('F-2206 AC-2: the items are Linux, Windows and macOS in that order', () => {
    deepStrictEqual(platformPickOf('box', 'ask').items, [
      {label: 'Linux', platform: 'linux'},
      {label: 'Windows', platform: 'windows'},
      {label: 'macOS', platform: 'macOS'},
    ]);
  });

  for (const platform of ['linux', 'windows', 'macOS'] as const) {
    it(`F-2206 5.2 step 3: the choice of ${platform} is given back`, async () => {
      const {port} = portAnswering(platform);
      deepStrictEqual(
        await pickRemotePlatform(
          port,
          'box',
          'ask',
          new AbortController().signal,
        ),
        platform,
      );
    });
  }

  it('F-2206 AC-9: a pick closed without a choice is cancelled', async () => {
    const {port} = portAnswering(undefined);
    deepStrictEqual(
      await pickRemotePlatform(
        port,
        'box',
        'ask',
        new AbortController().signal,
      ),
      'cancelled',
    );
  });

  it('F-2206 7.E1: a connect already cancelled is cancelled and shows nothing', async () => {
    const {port, shown} = portAnswering('linux');
    const controller = new AbortController();
    controller.abort();
    deepStrictEqual(
      [await pickRemotePlatform(port, 'box', 'ask', controller.signal), shown],
      ['cancelled', []],
    );
  });

  it('contracts 3.2: the pick shown is the one for the host', async () => {
    const {port, shown} = portAnswering('linux');
    await pickRemotePlatform(port, 'box', 'ask', new AbortController().signal);
    deepStrictEqual(shown, [platformPickOf('box', 'ask')]);
  });

  it('contracts 3.2: the port gets the connect signal itself', async () => {
    const {port, signals} = portAnswering('linux');
    const signal = new AbortController().signal;
    await pickRemotePlatform(port, 'box', 'ask', signal);
    deepStrictEqual(signals[0] === signal, true);
  });
});
