import type {TemplateProblem} from 'lib-product';
import type {DownloadPlacement} from '../policy/record.ts';

/** What the planner knows about the host before any channel is used. */
export interface HostFacts {
  operatingSystem: 'linux' | 'darwin' | 'windows' | 'alpine';
  architecture: string;
  homeFolder: string;
  existingLayouts: readonly ExistingLayout[];
}

/** A server the probe already found on the host: the VS Code layout or the CLI layout. */
export type ExistingLayout =
  | {kind: 'bin'; commit: string; path: string}
  | {kind: 'cliServers'; commit: string; path: string};

/** Everything the planner decides from: the caller has already looked up the setting and the source. */
export interface PlanInput {
  facts: HostFacts;
  commit: string;
  serverDataFolderName: string;
  launcher: string;
  /** `remote.SSH.serverInstallPath` for this host, already looked up. */
  installPathSetting: string | undefined;
  placement: DownloadPlacement;
  useExecServerSetting: boolean;
  source:
    | {kind: 'resolved'; address: string}
    | {kind: 'noSource'}
    | {kind: 'invalidOverride'; problem: TemplateProblem};
}

/** The reuse and download shapes the caller acts on. */
export type Plan =
  | {
      kind: 'reuse';
      layout: ExistingLayout;
      dataFolder: string;
      launcher: string;
      lockPlace: string;
      notes: readonly PlanNote[];
    }
  | {
      kind: 'download';
      where: 'host' | 'client';
      clientFallback: boolean;
      address: string;
      installFolder: string;
      dataFolder: string;
      launcher: string;
      lockPlace: string;
      notes: readonly PlanNote[];
    };

/** Why the plan could not be made, before any channel is used. */
export type PlanFailure =
  | {kind: 'noSource'}
  | {kind: 'invalidOverride'; problem: TemplateProblem}
  | {
      kind: 'invalidInstallPath';
      reason: 'relative' | 'empty' | 'containsNewline';
    };

/** The notes a plan carries for the caller to log once per connect. */
export type PlanNote = 'useExecServerIgnored';

/**
 * Decide where the server comes from and where it lives, before any channel is used. The install
 * path is checked first, then reuse of an existing layout with the same commit (a bin layout before
 * a cliServers one), and only then the source; the download runs where the placement says. The
 * data folder is the install path (or the home folder) joined with the data folder name by `/` on
 * every platform, so a Windows drive folder keeps its backslashes and the join stays a `/`.
 */
export function plan(input: PlanInput): {plan: Plan} | {failure: PlanFailure} {
  const setting = input.installPathSetting;
  if (setting !== undefined) {
    const trimmed = setting.trim();
    if (trimmed === '') {
      return {failure: {kind: 'invalidInstallPath', reason: 'empty'}};
    }
    if (setting.includes('\n')) {
      return {failure: {kind: 'invalidInstallPath', reason: 'containsNewline'}};
    }
    const absolute =
      trimmed.startsWith('/') ||
      trimmed.startsWith('~') ||
      /^[A-Za-z]:/.test(trimmed);
    if (!absolute) {
      return {failure: {kind: 'invalidInstallPath', reason: 'relative'}};
    }
  }
  const root =
    setting === undefined
      ? input.facts.homeFolder
      : expandHome(setting, input.facts.homeFolder);
  const dataFolder = `${root}/${input.serverDataFolderName}`;
  // The host lock lives in a folder, <dataFolder>/bin/<commit>, the same as the install folder;
  // the lock file's own name is composed by V1's script, not here.
  const lockPlace = `${dataFolder}/bin/${input.commit}`;
  const notes: PlanNote[] = input.useExecServerSetting
    ? ['useExecServerIgnored']
    : [];
  const reused = reuseBeforeSource(
    input.facts.existingLayouts,
    input.commit,
    dataFolder,
    input.launcher,
    lockPlace,
    notes,
  );
  if (reused !== undefined) {
    return {plan: reused};
  }
  if (input.source.kind === 'noSource') {
    return {failure: {kind: 'noSource'}};
  }
  if (input.source.kind === 'invalidOverride') {
    return {failure: {kind: 'invalidOverride', problem: input.source.problem}};
  }
  const placement = placementOf(input.placement);
  return {
    plan: {
      kind: 'download',
      where: placement.where,
      clientFallback: placement.clientFallback,
      address: input.source.address,
      installFolder: `${dataFolder}/bin/${input.commit}`,
      dataFolder,
      launcher: input.launcher,
      lockPlace,
      notes,
    },
  };
}

/** `~` and `~/x` expand against the home folder; everything else is used as written. */
function expandHome(path: string, homeFolder: string): string {
  if (path === '~') {
    return homeFolder;
  }
  if (path.startsWith('~/')) {
    return `${homeFolder}${path.slice(1)}`;
  }
  return path;
}

/** Where the download runs and whether it may fall back, from the placement. */
function placementOf(placement: DownloadPlacement): {
  where: 'host' | 'client';
  clientFallback: boolean;
} {
  if (placement.kind === 'hostFirst') {
    if (placement.mode === 'always') {
      return {where: 'client', clientFallback: false};
    }
    return {where: 'host', clientFallback: placement.mode === 'auto'};
  }
  if (placement.kind === 'clientFirstThenHost') {
    return {where: 'client', clientFallback: true};
  }
  return {where: 'client', clientFallback: false};
}

/**
 * The layout reused before the source is read: a bin layout with the same commit, else a
 * cliServers one, else none.
 */
function reuseBeforeSource(
  layouts: readonly ExistingLayout[],
  commit: string,
  dataFolder: string,
  launcher: string,
  lockPlace: string,
  notes: readonly PlanNote[],
): Plan | undefined {
  const layout =
    layouts.find(
      (value): value is Extract<ExistingLayout, {kind: 'bin'}> =>
        value.kind === 'bin' && value.commit === commit,
    ) ??
    layouts.find(
      (value): value is Extract<ExistingLayout, {kind: 'cliServers'}> =>
        value.kind === 'cliServers' && value.commit === commit,
    );
  if (layout === undefined) {
    return undefined;
  }
  return {kind: 'reuse', layout, dataFolder, launcher, lockPlace, notes};
}
