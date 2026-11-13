/**
 * @fileoverview The probes of the proposed-API gate: for each proposal an extension declares, whether the editor
 * grants it. A probe reads a member the editor guards with the proposal and sees whether it throws. It only reads: the
 * editor may be asked for the list of tunnels, or briefly start and stop the feed of terminal data, but no state is
 * written and the code the proposal is for never runs.
 */

/** The proposals the family declares. */
export type ProposalName =
  | 'resolvers'
  | 'tunnels'
  | 'contribViewsRemote'
  | 'terminalDataWriteEvent'
  | 'contribRemoteHelp'
  | 'extensionsAny'
  | 'workspaceTrust'
  | 'terminalDimensions'
  | 'contribEditSessions';

/** Whether the editor grants a proposal, denies it, or gives no way to tell. */
export type ProposalState = 'granted' | 'missing' | 'unprobeable';

/** What a probe reads: the members of the editor's API that a missing proposal guards. */
export interface ProbeApi {
  /** Guarded by `resolvers`: reading it throws without the grant. */
  readonly appCommit: string | undefined;
  /** Guarded by `tunnels`: reading it throws without the grant. */
  readonly tunnels: PromiseLike<unknown>;
  /** Guarded by `terminalDataWriteEvent`: subscribing throws without the grant. */
  onDidWriteTerminalData(listener: () => void): {dispose(): void};
  /** Lists the commands; the views of `contribViewsRemote` exist as `<view id>.focus` only with the grant. */
  getCommands(filterInternal: boolean): PromiseLike<string[]>;
  /** Calls `callback` once after `milliseconds`; the returned function cancels it. */
  startTimer(milliseconds: number, callback: () => void): () => void;
}

/**
 * How `contribViewsRemote` is told: `withList` takes it as granted with `resolvers` or `tunnels`, because every route
 * that enables proposals grants an extension's whole list; `byCommand` reads the focus commands of the views alone.
 */
export type ViewsProbe = 'byCommand' | 'withList';

/** A wait for the first resolve of the window to settle, which never lasts past its bound. */
export interface SettleWait {
  resolveSettled(): PromiseLike<void>;
  /** The longest the read waits for the settle, in milliseconds. */
  boundMilliseconds: number;
}

/** The proposals to probe, and the ids of the remote views the extension contributes. */
export interface ProbeRequest {
  proposals: readonly ProposalName[];
  viewIds: readonly string[];
  /** How the views proposal is told; `withList` when absent. */
  views?: ViewsProbe;
  /** With `byCommand`, the wait for the first resolve before the commands are read; none reads them at once. */
  settle?: SettleWait;
}

/** One probed proposal. */
export interface ProposalProbe {
  proposal: ProposalName;
  state: ProposalState;
}

/** `granted` when reading succeeds, `missing` when it throws. */
function attempt(read: () => void): ProposalState {
  try {
    read();
    return 'granted';
  } catch {
    // The editor throws for a member whose proposal is not enabled for the extension.
    return 'missing';
  }
}

/** Resolves when the settle does, or when its bound passes, whichever comes first. */
function settledWithin(editor: ProbeApi, settle: SettleWait): Promise<void> {
  return new Promise<void>(resolve => {
    const cancel = editor.startTimer(settle.boundMilliseconds, resolve);
    function done(): void {
      cancel();
      resolve();
    }
    void Promise.resolve(settle.resolveSettled()).then(done, done);
  });
}

/** The views of the extension exist as focus commands exactly when the proposal grants their placement. */
async function probeViews(
  editor: ProbeApi,
  viewIds: readonly string[],
  settle?: SettleWait,
): Promise<ProposalState> {
  if (viewIds.length === 0) {
    return 'unprobeable';
  }
  if (settle !== undefined) {
    await settledWithin(editor, settle);
  }
  try {
    const commands = new Set(await editor.getCommands(true));
    return viewIds.every(viewId => commands.has(`${viewId}.focus`))
      ? 'granted'
      : 'missing';
  } catch {
    // A command list that cannot be read tells nothing about the proposal.
    return 'unprobeable';
  }
}

/** The state of a proposal that its own member tells; the others cannot be told from one. */
function probeOne(editor: ProbeApi, proposal: ProposalName): ProposalState {
  switch (proposal) {
    case 'resolvers':
      return attempt(() => editor.appCommit);
    case 'tunnels':
      return attempt(() => {
        // Only the guard is under test; the list itself, and a failure to get it, do not matter here.
        void Promise.resolve(editor.tunnels).catch(() => undefined);
      });
    case 'terminalDataWriteEvent':
      return attempt(() => {
        editor.onDidWriteTerminalData(() => undefined).dispose();
      });
    default:
      return 'unprobeable';
  }
}

/** The proposals whose grant is read from the editor's API; an extension granted one of them is granted its whole list. */
const CALL_PROBED: readonly ProposalName[] = ['resolvers', 'tunnels'];

/**
 * Probes each requested proposal, in the order given. Nothing is cached: every call asks the editor again, because a
 * grant can change between activations.
 *
 * Every route that enables proposals grants an extension's declared list as one unit, so `contribViewsRemote` is
 * granted when `resolvers` or `tunnels` is, without reading the commands: in a window that is connecting, the editor
 * registers the views only after the authority is resolved, which is after the resolver's activation. The commands
 * are read only for an extension with no granted member of its own to go by. With `views: 'byCommand'` the commands
 * alone decide, after the request's settle wait when it has one, whatever `resolvers` says.
 */
export async function probeProposals(
  editor: ProbeApi,
  request: ProbeRequest,
): Promise<ProposalProbe[]> {
  const probes = request.proposals.map(proposal => ({
    proposal,
    state: probeOne(editor, proposal),
  }));
  const listGranted =
    request.views !== 'byCommand' &&
    probes.some(
      probe =>
        CALL_PROBED.includes(probe.proposal) && probe.state === 'granted',
    );
  return Promise.all(
    probes.map(async probe =>
      probe.proposal === 'contribViewsRemote'
        ? {
            proposal: probe.proposal,
            state: listGranted
              ? 'granted'
              : await probeViews(editor, request.viewIds, request.settle),
          }
        : probe,
    ),
  );
}
