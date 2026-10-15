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
}

/** The proposals to probe, and the ids of the remote views the extension contributes. */
export interface ProbeRequest {
  proposals: readonly ProposalName[];
  viewIds: readonly string[];
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

/** The views of the extension exist as focus commands exactly when the proposal grants their placement. */
async function probeViews(
  editor: ProbeApi,
  viewIds: readonly string[],
): Promise<ProposalState> {
  if (viewIds.length === 0) {
    return 'unprobeable';
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
 * are read only for an extension with no granted member of its own to go by.
 */
export async function probeProposals(
  editor: ProbeApi,
  request: ProbeRequest,
): Promise<ProposalProbe[]> {
  const probes = request.proposals.map(proposal => ({
    proposal,
    state: probeOne(editor, proposal),
  }));
  const listGranted = probes.some(
    probe => CALL_PROBED.includes(probe.proposal) && probe.state === 'granted',
  );
  return Promise.all(
    probes.map(async probe =>
      probe.proposal === 'contribViewsRemote'
        ? {
            proposal: probe.proposal,
            state: listGranted
              ? 'granted'
              : await probeViews(editor, request.viewIds),
          }
        : probe,
    ),
  );
}
