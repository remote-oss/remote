import {deepStrictEqual} from 'node:assert';
import {
  bundleFolderOf,
  failureCases,
  LABEL_FORM,
  launchesOf,
  suitesOf,
} from './acceptance-launches.ts';
import {REPOSITORY_ROOT} from './repository.ts';

describe('the launches of the VSCodium run', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  it('D-85: the labels are local, remote, reconnect, the failing connects in the order of the cases file, then terminal', () => {
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

  it('D-85: only the terminal launch has settings of its own', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.settings !== undefined)
        .map(launch => launch.label),
      ['terminal'],
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
