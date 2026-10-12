import {deepStrictEqual, throws} from 'node:assert';
import {
  plan,
  type DownloadPlacement,
  type ExistingLayout,
  type HostFacts,
  type Plan,
  type PlanFailure,
  type PlanInput,
} from '../../src/index.ts';

// The host every row of this file runs on unless a row says otherwise.
const facts: HostFacts = {
  operatingSystem: 'linux',
  architecture: 'x64',
  homeFolder: '/home/u',
  existingLayouts: [],
};

// One input the rows replace field by field.
function input(mutations: Partial<PlanInput>): PlanInput {
  return {
    facts,
    commit: 'abc',
    serverDataFolderName: '.vscode-server',
    launcher: 'code-server',
    installPathSetting: undefined,
    placement: {kind: 'hostFirst', mode: 'auto'},
    useExecServerSetting: false,
    source: {kind: 'noSource'},
    ...mutations,
  };
}

function binLayout(
  commit: string,
  path = '/home/u/.vscode-server/bin',
): ExistingLayout {
  return {kind: 'bin', commit, path};
}

function cliLayout(commit: string): ExistingLayout {
  return {kind: 'cliServers', commit, path: '/home/u/.vscode-cli'};
}

// The plan side of the result; the rows of this file all produce a plan.
function asPlan(result: {plan: Plan} | {failure: PlanFailure}): Plan {
  if ('failure' in result) {
    throw new Error('expected a plan, got a failure');
  }
  return result.plan;
}

// The placement rows: the download runs where the placement says.
function placementRow(
  placement: DownloadPlacement,
  expected: {where: 'host' | 'client'; clientFallback: boolean},
): void {
  const result = plan(
    input({
      placement,
      source: {kind: 'resolved', address: 'https://x/s.tgz'},
    }),
  );
  const planOf = asPlan(result);
  deepStrictEqual(planOf.kind, 'download');
  deepStrictEqual(planOf.where, expected.where);
  deepStrictEqual(planOf.clientFallback, expected.clientFallback);
}

describe('install planner (card server-04 table)', () => {
  it("installPathSetting '   ' -> failure invalidInstallPath, reason empty", () => {
    deepStrictEqual(plan(input({installPathSetting: '   '})), {
      failure: {kind: 'invalidInstallPath', reason: 'empty'},
    });
  });

  it("installPathSetting 'rel/path' -> failure invalidInstallPath, reason relative", () => {
    deepStrictEqual(plan(input({installPathSetting: 'rel/path'})), {
      failure: {kind: 'invalidInstallPath', reason: 'relative'},
    });
  });

  it("installPathSetting '/a\\nb' -> failure invalidInstallPath, reason containsNewline", () => {
    deepStrictEqual(plan(input({installPathSetting: '/a\nb'})), {
      failure: {kind: 'invalidInstallPath', reason: 'containsNewline'},
    });
  });

  it("installPathSetting 'C:\\srv' on windows -> download, dataFolder 'C:\\srv/.vscode-server' (joined with / on every platform)", () => {
    const result = plan(
      input({
        facts: {
          ...facts,
          operatingSystem: 'windows',
          homeFolder: 'C:/Users/u',
        },
        installPathSetting: 'C:\\srv',
        source: {kind: 'resolved', address: 'https://x/s.tgz'},
      }),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).dataFolder,
      'C:\\srv/.vscode-server',
    );
  });

  it('installPathSetting undefined, home /home/u -> dataFolder /home/u/.vscode-server', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).dataFolder,
      '/home/u/.vscode-server',
    );
  });

  it("installPathSetting '~/srv' -> dataFolder /home/u/srv/.vscode-server", () => {
    const result = plan(
      input({
        installPathSetting: '~/srv',
        source: {kind: 'resolved', address: 'https://x/s.tgz'},
      }),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).dataFolder,
      '/home/u/srv/.vscode-server',
    );
  });

  it("installPathSetting '~' -> dataFolder /home/u/.vscode-server", () => {
    const result = plan(
      input({
        installPathSetting: '~',
        source: {kind: 'resolved', address: 'https://x/s.tgz'},
      }),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).dataFolder,
      '/home/u/.vscode-server',
    );
  });

  it('an existing bin layout with the plan commit and source noSource -> reuse of that layout (reuse before source)', () => {
    const layout = binLayout('abc');
    deepStrictEqual(
      plan(input({facts: {...facts, existingLayouts: [layout]}})),
      {
        plan: {
          kind: 'reuse',
          layout,
          dataFolder: '/home/u/.vscode-server',
          launcher: 'code-server',
          lockPlace: '/home/u/.vscode-server/bin/abc',
          notes: [],
        },
      },
    );
  });

  it('an existing cliServers layout with the commit and no bin layout -> reuse of the cliServers layout', () => {
    const layout = cliLayout('abc');
    const result = plan(input({facts: {...facts, existingLayouts: [layout]}}));
    const planOf = asPlan(result);
    deepStrictEqual(
      [planOf.kind, (planOf as Plan & {kind: 'reuse'}).layout],
      ['reuse', layout],
    );
  });

  it('an existing bin layout with another commit and a resolved source -> download', () => {
    const result = plan(
      input({
        facts: {...facts, existingLayouts: [binLayout('other')]},
        source: {kind: 'resolved', address: 'https://x/s.tgz'},
      }),
    );
    deepStrictEqual(asPlan(result).kind, 'download');
  });

  it('both layouts with the commit -> reuse the bin one', () => {
    const binOne = binLayout('abc');
    const cliOne = cliLayout('abc');
    const result = plan(
      input({facts: {...facts, existingLayouts: [cliOne, binOne]}}),
    );
    deepStrictEqual((asPlan(result) as Plan & {kind: 'reuse'}).layout, binOne);
  });

  it('no layout and source noSource -> failure noSource', () => {
    deepStrictEqual(plan(input({})), {failure: {kind: 'noSource'}});
  });

  it("no layout and source invalidOverride {problem: 'notHttpUrl'} -> failure invalidOverride with the problem", () => {
    deepStrictEqual(
      plan(
        input({
          source: {
            kind: 'invalidOverride',
            problem: {kind: 'notHttpUrl', value: 'x'},
          },
        }),
      ),
      {
        failure: {
          kind: 'invalidOverride',
          problem: {kind: 'notHttpUrl', value: 'x'},
        },
      },
    );
  });

  it('hostFirst auto, resolved source -> download, where host, clientFallback true', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    const planOf = asPlan(result) as Plan & {kind: 'download'};
    deepStrictEqual(
      [planOf.kind, planOf.where, planOf.clientFallback],
      ['download', 'host', true],
    );
  });

  it('hostFirst always -> where client, clientFallback false', () => {
    placementRow(
      {kind: 'hostFirst', mode: 'always'},
      {where: 'client', clientFallback: false},
    );
  });

  it('hostFirst off -> where host, clientFallback false', () => {
    placementRow(
      {kind: 'hostFirst', mode: 'off'},
      {where: 'host', clientFallback: false},
    );
  });

  it('clientFirstThenHost -> where client, clientFallback true', () => {
    placementRow(
      {kind: 'clientFirstThenHost'},
      {where: 'client', clientFallback: true},
    );
  });

  it('clientOnly -> where client, clientFallback false', () => {
    placementRow(
      {kind: 'clientOnly'},
      {where: 'client', clientFallback: false},
    );
  });

  it('installFolder for commit abc, dataFolder /home/u/.vscode-server -> /home/u/.vscode-server/bin/abc', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).installFolder,
      '/home/u/.vscode-server/bin/abc',
    );
  });

  it('lockPlace -> /home/u/.vscode-server/bin/abc', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).lockPlace,
      '/home/u/.vscode-server/bin/abc',
    );
  });

  it('brief §2: useExecServerSetting true on a download, with no mode asked for, notes nothing', () => {
    const result = plan(
      input({
        useExecServerSetting: true,
        source: {kind: 'resolved', address: 'https://x/s.tgz'},
      }),
    );
    deepStrictEqual((asPlan(result) as Plan & {kind: 'download'}).notes, []);
  });

  it('brief §2: useExecServerSetting true on a reuse, with no mode asked for, notes nothing', () => {
    const result = plan(
      input({
        facts: {...facts, existingLayouts: [binLayout('abc')]},
        useExecServerSetting: true,
      }),
    );
    deepStrictEqual((asPlan(result) as Plan & {kind: 'reuse'}).notes, []);
  });

  it('useExecServerSetting false -> notes empty', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    deepStrictEqual((asPlan(result) as Plan & {kind: 'download'}).notes, []);
  });

  it('address is copied from the resolved source', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).address,
      'https://x/s.tgz',
    );
  });

  it('the invalid path case with a reusable layout present -> failure invalidInstallPath (the path check comes first)', () => {
    const result = plan(
      input({
        facts: {...facts, existingLayouts: [binLayout('abc')]},
        installPathSetting: 'rel/path',
      }),
    );
    deepStrictEqual(result, {
      failure: {kind: 'invalidInstallPath', reason: 'relative'},
    });
  });
});

// The mode inputs of a connect that may use the CLI: every row but the one a row changes.
const cliMode: NonNullable<PlanInput['cliMode']> = {
  useExecServerSetting: true,
  manualBootstrap: false,
  cliTemplate: 'https://x/${version}/cli-${os}-${arch}.tar.gz',
  sourcesFree: true,
};

// A plan input that asks for the CLI mode on the standard host, with a data folder under the home folder.
function cliInput(mutations: Partial<PlanInput>): PlanInput {
  return input({
    serverDataFolderName: '.data',
    cliMode,
    cliName: 'editor-abc',
    cliPresentOnHost: false,
    source: {kind: 'resolved', address: 'https://x/s.tgz'},
    ...mutations,
  });
}

describe('install planner, the CLI mode (card cli-02 table)', () => {
  it('brief §2: with the CLI absent the plan is a CLI plan that downloads it, on the host with a fallback', () => {
    deepStrictEqual(plan(cliInput({})), {
      plan: {
        kind: 'cli',
        cliPath: '/home/u/.data/editor-abc',
        cliDataFolder: '/home/u/.data/cli',
        download: true,
        where: 'host',
        clientFallback: true,
        dataFolder: '/home/u/.data',
        lockPlace: '/home/u/.data/bin/abc',
        notes: [],
      },
    });
  });

  it('F-2103 BR-8, BR-7: a server of the commit in a bin layout does not turn a CLI plan into a reuse', () => {
    deepStrictEqual(
      asPlan(
        plan(
          cliInput({
            facts: {
              ...facts,
              existingLayouts: [binLayout('abc', '/home/u/.data/bin')],
            },
          }),
        ),
      ).kind,
      'cli',
    );
  });

  it('brief §4: a CLI that is already there is not downloaded again', () => {
    deepStrictEqual(
      (asPlan(plan(cliInput({cliPresentOnHost: true}))) as Plan & {kind: 'cli'})
        .download,
      false,
    );
  });

  it('brief §4: the placement always downloads on the client, without a fallback', () => {
    const planned = asPlan(
      plan(cliInput({placement: {kind: 'hostFirst', mode: 'always'}})),
    ) as Plan & {kind: 'cli'};
    deepStrictEqual([planned.where, planned.clientFallback], ['client', false]);
  });

  it('brief §2 row 2: a product without a CLI source gets a direct plan that notes why', () => {
    const planned = asPlan(
      plan(cliInput({cliMode: {...cliMode, cliTemplate: ''}})),
    );
    deepStrictEqual(
      [planned.kind, planned.notes],
      ['download', [{kind: 'cliNotUsed', reason: 'noCliSource'}]],
    );
  });

  it('brief §2 row 1: a setting that is off gets a direct plan that notes nothing', () => {
    const planned = asPlan(
      plan(cliInput({cliMode: {...cliMode, useExecServerSetting: false}})),
    );
    deepStrictEqual([planned.kind, planned.notes], ['download', []]);
  });

  it('brief §2 row 3: a platform without a CLI build gets a direct plan that notes why', () => {
    const planned = asPlan(
      plan(
        cliInput({
          facts: {...facts, architecture: 'riscv64'},
        }),
      ),
    );
    deepStrictEqual(planned.notes, [
      {kind: 'cliNotUsed', reason: 'noBuildForPlatform'},
    ]);
  });

  it('brief §2 row 4: sources that need terms accepted get a direct plan that notes why', () => {
    const planned = asPlan(
      plan(cliInput({cliMode: {...cliMode, sourcesFree: false}})),
    );
    deepStrictEqual(planned.notes, [
      {kind: 'cliNotUsed', reason: 'termsToAccept'},
    ]);
  });

  it('brief §2: a direct plan after a CLI refusal still reuses a server of the commit', () => {
    const planned = asPlan(
      plan(
        cliInput({
          cliMode: {...cliMode, cliTemplate: ''},
          facts: {...facts, existingLayouts: [binLayout('abc')]},
        }),
      ),
    );
    deepStrictEqual(
      [planned.kind, planned.notes],
      ['reuse', [{kind: 'cliNotUsed', reason: 'noCliSource'}]],
    );
  });

  it('brief §2: an invalid install path is judged before the mode', () => {
    deepStrictEqual(plan(cliInput({installPathSetting: 'relative/path'})), {
      failure: {kind: 'invalidInstallPath', reason: 'relative'},
    });
  });

  it('brief §3: a mode asked for without the CLI name is a defect and throws', () => {
    const withName = cliInput({});
    delete withName.cliName;
    throws(() => plan(withName), /cliName/);
  });
});
