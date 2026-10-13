import {deepStrictEqual} from 'node:assert';
import {
  bundleFolderOf,
  CONFIG_FILE_LAUNCHES,
  extensionsOf,
  failureCases,
  LABEL_FORM,
  launchesOf,
  runnerLaunches,
  suitesOf,
} from './acceptance-launches.ts';
import {REPOSITORY_ROOT} from './repository.ts';

describe('the launches of the VSCodium run', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  it('D-85: the labels are local, remote, reconnect, the failing connects in the order of the cases file, then terminal, slow and windows', () => {
    deepStrictEqual(
      launches.map(launch => launch.label),
      [
        'local',
        'remote',
        'reconnect',
        ...failureCases(REPOSITORY_ROOT).map(
          failure => `failure-${failure.alias}`,
        ),
        'terminal',
        'slow',
        'windows',
      ],
    );
  });

  it('D-85: every label has the form of an alias', () => {
    deepStrictEqual(
      launches.filter(launch => !LABEL_FORM.test(launch.label)),
      [],
    );
  });

  it('D-85: the terminal launch turns the local server off', () => {
    deepStrictEqual(
      launches.find(launch => launch.label === 'terminal')?.settings,
      {'remote.SSH.useLocalServer': false},
    );
  });

  it('D-85: no launch outside the list sets remote.SSH.configFile', () => {
    deepStrictEqual(
      launches
        .filter(
          launch =>
            launch.settings?.['remote.SSH.configFile'] !== undefined &&
            !CONFIG_FILE_LAUNCHES.includes(launch.label),
        )
        .map(launch => launch.label),
      [],
    );
  });

  it('D-85: only the terminal launch has settings of its own', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.settings !== undefined)
        .map(launch => launch.label),
      ['terminal'],
    );
  });
});

describe('the launch with no runner', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  it('D-85: the windows launch is plain and has a suite folder of Node tests', () => {
    deepStrictEqual(
      launches.filter(launch => launch.kind === 'plain'),
      [{label: 'windows', kind: 'plain', suite: 'windows'}],
    );
  });

  it('D-85: the launches with a runner leave out the plain one', () => {
    deepStrictEqual(
      runnerLaunches(launches).filter(launch => launch.label === 'windows'),
      [],
    );
  });

  it('D-85: a plain launch is bundled into no folder', () => {
    deepStrictEqual(
      suitesOf(launches).filter(suite => suite === 'windows'),
      [],
    );
  });
});

describe('the suites of the launches', () => {
  it('D-85: the shared suite comes first and a suite shared by launches is listed once', () => {
    deepStrictEqual(
      suitesOf([
        {label: 'one', runner: 'runner', suite: 'suite-a'},
        {label: 'two', runner: 'runner', suite: 'suite-a'},
        {label: 'three', runner: 'runner', suite: 'suite-b'},
      ]),
      ['suite', 'suite-a', 'suite-b'],
    );
  });

  it('D-85: the suites of the repository hold suite-terminal once', () => {
    deepStrictEqual(
      suitesOf(launchesOf(REPOSITORY_ROOT)).filter(
        suite => suite === 'suite-terminal',
      ),
      ['suite-terminal'],
    );
  });

  it('D-85: the shared suite is bundled into dist', () => {
    deepStrictEqual(bundleFolderOf('suite'), 'dist');
  });

  it('D-85: a launch suite is bundled into dist-<name>', () => {
    deepStrictEqual(bundleFolderOf('suite-terminal'), 'dist-terminal');
  });
});

describe('the further extensions of the launches', () => {
  it('D-85: the repository loads the slow extension once', () => {
    deepStrictEqual(extensionsOf(launchesOf(REPOSITORY_ROOT)), ['slow-remote']);
  });

  it('D-85: an extension two launches load is listed once', () => {
    deepStrictEqual(
      extensionsOf([
        {label: 'one', runner: 'runner', suite: 's', extraExtensions: ['a']},
        {
          label: 'two',
          runner: 'runner',
          suite: 's',
          extraExtensions: ['a', 'b'],
        },
      ]),
      ['a', 'b'],
    );
  });
});
