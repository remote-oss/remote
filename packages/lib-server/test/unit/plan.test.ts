import {deepStrictEqual} from 'node:assert';
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
          lockPlace: '/home/u/.vscode-server/install.lock',
          notes: [],
        },
      },
    );
  });

  it('an existing cliServers layout with the commit and no bin layout -> reuse of the cliServers layout', () => {
    const layout = cliLayout('abc');
    const result = plan(input({facts: {...facts, existingLayouts: [layout]}}));
    deepStrictEqual(asPlan(result).kind, 'reuse');
    deepStrictEqual((asPlan(result) as Plan & {kind: 'reuse'}).layout, layout);
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
      plan(input({source: {kind: 'invalidOverride', problem: 'notHttpUrl'}})),
      {failure: {kind: 'invalidOverride', problem: 'notHttpUrl'}},
    );
  });

  it('hostFirst auto, resolved source -> download, where host, clientFallback true', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    const planOf = asPlan(result);
    deepStrictEqual(planOf.kind, 'download');
    deepStrictEqual(planOf.where, 'host');
    deepStrictEqual(planOf.clientFallback, true);
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

  it('lockPlace -> /home/u/.vscode-server/install.lock', () => {
    const result = plan(
      input({source: {kind: 'resolved', address: 'https://x/s.tgz'}}),
    );
    deepStrictEqual(
      (asPlan(result) as Plan & {kind: 'download'}).lockPlace,
      '/home/u/.vscode-server/install.lock',
    );
  });

  it('useExecServerSetting true on a download -> notes contains useExecServerIgnored', () => {
    const result = plan(
      input({
        useExecServerSetting: true,
        source: {kind: 'resolved', address: 'https://x/s.tgz'},
      }),
    );
    deepStrictEqual((asPlan(result) as Plan & {kind: 'download'}).notes, [
      'useExecServerIgnored',
    ]);
  });

  it('useExecServerSetting true on a reuse -> notes contains useExecServerIgnored', () => {
    const result = plan(
      input({
        facts: {...facts, existingLayouts: [binLayout('abc')]},
        useExecServerSetting: true,
      }),
    );
    deepStrictEqual((asPlan(result) as Plan & {kind: 'reuse'}).notes, [
      'useExecServerIgnored',
    ]);
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
