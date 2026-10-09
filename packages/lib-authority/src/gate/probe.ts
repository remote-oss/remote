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
  | 'extensionsAny';

/** Whether the editor grants a proposal, denies it, or gives no way to tell. */
export type ProposalState = 'granted' | 'missing' | 'unprobeable';

/** What a probe reads: the members of the editor's API that a missing proposal guards. */
export interface ProbeApi {
  /** Guarded by `resolvers`: reading it throws without the grant. */
  readonly remoteAuthority: string | undefined;
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

async function probeOne(
  editor: ProbeApi,
  proposal: ProposalName,
  viewIds: readonly string[],
): Promise<ProposalState> {
  switch (proposal) {
    case 'resolvers':
      return attempt(() => editor.remoteAuthority);
    case 'tunnels':
      return attempt(() => {
        // Only the guard is under test; the list itself, and a failure to get it, do not matter here.
        void Promise.resolve(editor.tunnels).catch(() => undefined);
      });
    case 'terminalDataWriteEvent':
      return attempt(() => {
        editor.onDidWriteTerminalData(() => undefined).dispose();
      });
    case 'contribViewsRemote':
      return probeViews(editor, viewIds);
    default:
      return 'unprobeable';
  }
}

/**
 * Probes each requested proposal, in the order given. Nothing is cached: every call asks the editor again, because a
 * grant can change between activations.
 */
export async function probeProposals(
  editor: ProbeApi,
  request: ProbeRequest,
): Promise<ProposalProbe[]> {
  const probes: ProposalProbe[] = [];
  for (const proposal of request.proposals) {
    probes.push({
      proposal,
      state: await probeOne(editor, proposal, request.viewIds),
    });
  }
  return probes;
}
