import {deepStrictEqual} from 'node:assert';
import {
  readUserSettings,
  restoreUserSettings,
  runScopedName,
} from '../windows/harness.ts';
import {
  DEAD,
  dockerWith,
  engineSettingsAre,
  lists,
  type SecondEngine,
  secondEngine,
  showsNoEngine,
} from '../windows/engine-fixture.ts';

describe('the engine the Dev Containers view uses, from settings and contexts (card containers-133)', function () {
  this.timeout(900_000);

  let saved: string | undefined;
  let plain: SecondEngine;
  let secured: SecondEngine;

  /** Gives the user settings the bytes they had, with `change` over them and the engine settings removed first. */
  function settingsAre(
    change: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    return engineSettingsAre(saved, change);
  }

  before(async () => {
    saved = readUserSettings();
    plain = await secondEngine();
    secured = await secondEngine({secured: true});
  });

  after(async () => {
    restoreUserSettings(saved);
    await plain.stop();
    await secured.stop();
  });

  it('F-0205 AC-29 (c133-dead): a dead endpoint in only one of containers.environment, docker.environment and docker.host gives the view the welcome content of an unreachable engine, although the ambient context works', async () => {
    const shown: boolean[] = [];
    for (const change of [
      {'containers.environment': {DOCKER_HOST: DEAD}},
      {'docker.environment': {DOCKER_HOST: DEAD}},
      {'docker.host': DEAD},
    ]) {
      await settingsAre(change);
      shown.push(await showsNoEngine());
    }
    deepStrictEqual(shown, [true, true, true]);
  });

  it('F-0205 AC-31 (c133-precedence): containers.environment wins over docker.environment, which wins over docker.host; a removed one gives way to the next', async () => {
    const steps: Array<[Record<string, unknown>, boolean]> = [
      [
        {
          'containers.environment': {DOCKER_HOST: plain.address},
          'docker.environment': {DOCKER_HOST: DEAD},
          'docker.host': DEAD,
        },
        true,
      ],
      [
        {
          'containers.environment': {},
          'docker.environment': {DOCKER_HOST: plain.address},
          'docker.host': DEAD,
        },
        true,
      ],
      [
        {
          'containers.environment': {DOCKER_HOST: DEAD},
          'docker.environment': {DOCKER_HOST: plain.address},
          'docker.host': plain.address,
        },
        false,
      ],
      [{'docker.host': plain.address}, true],
    ];
    const seen: boolean[] = [];
    for (const [change] of steps) {
      await settingsAre(change);
      seen.push(await lists(plain.marker));
    }
    deepStrictEqual(
      seen,
      steps.map(([, expected]) => expected),
    );
  });

  it('F-0205 AC-33 (c133-tls): a TLS daemon is reached from docker.host with docker.certPath and docker.tlsVerify "1", and not from docker.host alone', async () => {
    await settingsAre({'docker.host': secured.address});
    const alone = await showsNoEngine();
    await settingsAre({
      'docker.host': secured.address,
      'docker.certPath': secured.certificates,
      'docker.tlsVerify': '1',
    });
    deepStrictEqual([alone, await lists(secured.marker)], [true, true]);
  });

  it('F-0205 AC-30, AC-31, AC-41 (c133-context): DOCKER_CONTEXT in containers.environment or docker.environment uses that context, a missing context gives the welcome content, a DOCKER_HOST in a lower setting wins over it, and a dead endpoint in the settings wins over a working current context', async () => {
    const context = runScopedName('c133ctx');
    await dockerWith(
      {},
      'context',
      'create',
      context,
      '--docker',
      `host=${plain.address}`,
    );
    try {
      const seen: boolean[] = [];
      await settingsAre({'containers.environment': {DOCKER_CONTEXT: context}});
      seen.push(await lists(plain.marker));
      await settingsAre({'docker.environment': {DOCKER_CONTEXT: context}});
      seen.push(await lists(plain.marker));
      await settingsAre({
        'containers.environment': {DOCKER_CONTEXT: 'c133-missing'},
      });
      seen.push(await showsNoEngine());
      await settingsAre({
        'containers.environment': {DOCKER_CONTEXT: context},
        'docker.host': DEAD,
      });
      seen.push(await showsNoEngine());
      await settingsAre({});
      await dockerWith({}, 'context', 'use', context);
      seen.push(await lists(plain.marker));
      for (const change of [
        {'containers.environment': {DOCKER_HOST: DEAD}},
        {'docker.environment': {DOCKER_HOST: DEAD}},
        {'docker.host': DEAD},
        {
          'containers.environment': {DOCKER_HOST: DEAD},
          'docker.environment': {DOCKER_CONTEXT: context},
        },
      ]) {
        await settingsAre(change);
        seen.push(await showsNoEngine());
      }
      deepStrictEqual(seen, Array<boolean>(9).fill(true));
    } finally {
      await dockerWith({}, 'context', 'use', 'default').catch(() => undefined);
      await dockerWith({}, 'context', 'rm', '--force', context).catch(
        () => undefined,
      );
    }
  });
});
