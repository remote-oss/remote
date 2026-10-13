import {deepStrictEqual, throws} from 'node:assert';
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
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('the launches of the VSCodium run', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  it('D-85: the labels are local, remote, reconnect, the failing connects in the order of the cases file, then terminal, slow, windows and no-proposals', () => {
    deepStrictEqual(
      launches.map(launch => launch.label),
      [
        'local',
        'remote',
        'reconnect',
        ...failureCases(REPOSITORY_ROOT).map(
          failure => `failure-${failure.label ?? failure.alias}`,
        ),
        'terminal',
        'slow',
        'windows',
        'no-proposals',
      ],
    );
  });

  it('D-85: every label has the form of an alias', () => {
    deepStrictEqual(
      launches.filter(launch => !LABEL_FORM.test(launch.label)),
      [],
    );
  });

  it('D-85: the terminal launch turns the local server off and names the platform of the host, so that no pick is asked', () => {
    deepStrictEqual(
      launches.find(launch => launch.label === 'terminal')?.settings,
      {
        'remote.SSH.useLocalServer': false,
        'remote.SSH.remotePlatform': {harness: 'linux'},
      },
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

  it('D-85: the settings of their own are the terminal launch and the failing connects that name them', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.settings !== undefined)
        .map(launch => launch.label),
      ['failure-refused-shown', 'terminal'],
    );
  });

  it('coverage-10: a failing connect with a label launches on failure-<label>, so one alias runs twice', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.suite === 'suite-failure')
        .map(launch => launch.label),
      [
        'failure-refused',
        'failure-nowhere',
        'failure-stranger',
        'failure-refused-shown',
        'failure-stranger-cancel',
      ],
    );
  });

  it('coverage-10: each failing connect names its case for the window, by its label or its alias', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.suite === 'suite-failure')
        .map(launch => [
          launch.label,
          launch.environment?.HARNESS_FAILURE_CASE,
        ]),
      [
        ['failure-refused', 'refused'],
        ['failure-nowhere', 'nowhere'],
        ['failure-stranger', 'stranger'],
        ['failure-refused-shown', 'refused-shown'],
        ['failure-stranger-cancel', 'stranger-cancel'],
      ],
    );
  });

  it('coverage-10: the settings of a failing connect reach its launch', () => {
    deepStrictEqual(
      [
        launches.find(launch => launch.label === 'failure-refused-shown')
          ?.settings,
        launches.find(launch => launch.label === 'failure-stranger-cancel')
          ?.settings,
      ],
      [{'remote.SSH.showLoginTerminal': true}, undefined],
    );
  });

  it('coverage-10: a label outside its form is refused', () => {
    const workspace = new TemporaryWorkspace('launches');
    try {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [{alias: 'a', cite: 'c', script: [], dialog: 'd', label: 'A-b'}],
      });
      throws(() => failureCases(workspace.root), /label must match/);
    } finally {
      workspace.remove();
    }
  });

  it("coverage-10: a label the same as another connect's alias is refused", () => {
    const workspace = new TemporaryWorkspace('launches');
    try {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [
          {alias: 'refused', cite: 'c', script: [], dialog: 'd'},
          {
            label: 'refused',
            alias: 'stranger',
            cite: 'c',
            script: [],
            dialog: 'd',
          },
        ],
      });
      throws(
        () => failureCases(workspace.root),
        /two failing connects share the label "refused"/,
      );
    } finally {
      workspace.remove();
    }
  });

  it('coverage-10: two connects with the same label are refused', () => {
    const workspace = new TemporaryWorkspace('launches');
    try {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [
          {label: 'x', alias: 'a', cite: 'c', script: [], dialog: 'd'},
          {label: 'x', alias: 'b', cite: 'c', script: [], dialog: 'd'},
        ],
      });
      throws(
        () => failureCases(workspace.root),
        /two failing connects share the label "x"/,
      );
    } finally {
      workspace.remove();
    }
  });
});

describe('the launch with no runner', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  it('D-85: the windows launch is plain and has a suite folder of Node tests', () => {
    deepStrictEqual(
      launches.filter(launch => launch.label === 'windows'),
      [{label: 'windows', kind: 'plain', suite: 'windows'}],
    );
  });

  it('F-3903 §5 rule 4: the no-proposals launch is plain and starts the editor without the proposed API', () => {
    deepStrictEqual(
      launches.filter(launch => launch.label === 'no-proposals'),
      [
        {
          label: 'no-proposals',
          kind: 'plain',
          suite: 'no-proposals',
          proposedApi: false,
        },
      ],
    );
  });

  it('F-3903 §5 rule 4: only the no-proposals launch leaves the proposed API out', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.proposedApi === false)
        .map(launch => launch.label),
      ['no-proposals'],
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
