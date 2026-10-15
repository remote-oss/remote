import {deepStrictEqual} from 'node:assert';
import {
  type ProbeApi,
  probeProposals,
  type ProposalName,
  type ProposalState,
} from '../../src/index.ts';

const REFUSAL = new Error('Extension CANNOT use API proposal');

/** What the fake editor does when a probe touches a guarded member. */
interface Editor {
  guarded: ReadonlySet<ProposalName>;
  commands?: readonly string[];
  commandsFail?: boolean;
  tunnelsReject?: boolean;
}

/** A fake of the editor's API that throws where a missing proposal would, and counts what the probes touch. */
class FakeApi implements ProbeApi {
  reads: string[] = [];
  disposed = 0;
  private readonly editor: Editor;

  constructor(editor: Partial<Editor> = {}) {
    this.editor = {guarded: new Set(), ...editor};
  }

  get appCommit(): string | undefined {
    this.reads.push('appCommit');
    if (this.editor.guarded.has('resolvers')) {
      throw REFUSAL;
    }
    return undefined;
  }

  get tunnels(): PromiseLike<unknown> {
    this.reads.push('tunnels');
    if (this.editor.guarded.has('tunnels')) {
      throw REFUSAL;
    }
    return this.editor.tunnelsReject === true
      ? Promise.reject(new Error('no tunnel service'))
      : Promise.resolve([]);
  }

  onDidWriteTerminalData(): {dispose(): void} {
    this.reads.push('onDidWriteTerminalData');
    if (this.editor.guarded.has('terminalDataWriteEvent')) {
      throw REFUSAL;
    }
    return {
      dispose: () => {
        this.disposed += 1;
      },
    };
  }

  getCommands(): PromiseLike<string[]> {
    this.reads.push('getCommands');
    return this.editor.commandsFail === true
      ? Promise.reject(new Error('commands unavailable'))
      : Promise.resolve([...(this.editor.commands ?? [])]);
  }
}

async function stateOf(
  editor: ProbeApi,
  proposal: ProposalName,
  viewIds: readonly string[] = [],
): Promise<ProposalState | undefined> {
  const probes = await probeProposals(editor, {proposals: [proposal], viewIds});
  return probes[0]?.state;
}

describe('probing the proposals of the editor (F-1403)', () => {
  it('F-3903 rule 4: the resolvers probe reads appCommit and is granted when it reads', async () => {
    const editor = new FakeApi();
    deepStrictEqual(
      [await stateOf(editor, 'resolvers'), editor.reads],
      ['granted', ['appCommit']],
    );
  });

  it('F-3903 rule 4: the resolvers probe is missing when appCommit throws', async () => {
    deepStrictEqual(
      await stateOf(
        new FakeApi({guarded: new Set(['resolvers'])}),
        'resolvers',
      ),
      'missing',
    );
  });

  it('F-1403: tunnels is granted when the guarded member can be read', async () => {
    deepStrictEqual(await stateOf(new FakeApi(), 'tunnels'), 'granted');
  });

  it('F-1403: tunnels is missing when the guarded member throws', async () => {
    const editor = new FakeApi({guarded: new Set(['tunnels'])});
    deepStrictEqual(await stateOf(editor, 'tunnels'), 'missing');
  });

  it('F-1403: tunnels is granted although the list of tunnels fails, because only the guard counts', async () => {
    const editor = new FakeApi({tunnelsReject: true});
    deepStrictEqual(await stateOf(editor, 'tunnels'), 'granted');
  });

  it('F-1403: terminalDataWriteEvent is granted when subscribing works', async () => {
    deepStrictEqual(
      await stateOf(new FakeApi(), 'terminalDataWriteEvent'),
      'granted',
    );
  });

  it('F-1403: the subscription made to probe terminalDataWriteEvent is disposed at once', async () => {
    const editor = new FakeApi();
    await stateOf(editor, 'terminalDataWriteEvent');
    deepStrictEqual(editor.disposed, 1);
  });

  it('F-1403: terminalDataWriteEvent is missing when subscribing throws', async () => {
    const editor = new FakeApi({guarded: new Set(['terminalDataWriteEvent'])});
    deepStrictEqual(await stateOf(editor, 'terminalDataWriteEvent'), 'missing');
  });

  it('F-1403: contribViewsRemote is granted when the focus command of every view exists', async () => {
    const editor = new FakeApi({commands: ['one.focus', 'two.focus', 'other']});
    deepStrictEqual(
      await stateOf(editor, 'contribViewsRemote', ['one', 'two']),
      'granted',
    );
  });

  it('F-1403: contribViewsRemote is missing when a view has no focus command', async () => {
    const editor = new FakeApi({commands: ['one.focus']});
    deepStrictEqual(
      await stateOf(editor, 'contribViewsRemote', ['one', 'two']),
      'missing',
    );
  });

  it('F-1403: contribViewsRemote lists the commands without the internal ones', async () => {
    const editor = new FakeApi({commands: ['one.focus']});
    await stateOf(editor, 'contribViewsRemote', ['one']);
    deepStrictEqual(editor.reads, ['getCommands']);
  });

  it('F-1403 §4, #996: contribViewsRemote is granted with resolvers, or with tunnels, whatever the commands hold, and the commands are not read', async () => {
    const outcomes = [];
    for (const proposals of [
      ['resolvers', 'contribViewsRemote'],
      ['contribViewsRemote', 'tunnels'],
    ] as const) {
      const editor = new FakeApi({commands: []});
      const probes = await probeProposals(editor, {
        proposals,
        viewIds: ['one'],
      });
      outcomes.push([
        probes.map(probe => [probe.proposal, probe.state]),
        editor.reads.includes('getCommands'),
      ]);
    }
    deepStrictEqual(outcomes, [
      [
        [
          ['resolvers', 'granted'],
          ['contribViewsRemote', 'granted'],
        ],
        false,
      ],
      [
        [
          ['contribViewsRemote', 'granted'],
          ['tunnels', 'granted'],
        ],
        false,
      ],
    ]);
  });

  it('F-1403 §4: contribViewsRemote reads the commands when resolvers and tunnels are not granted, or not asked for', async () => {
    const missing = new FakeApi({
      guarded: new Set(['resolvers', 'tunnels']),
      commands: [],
    });
    const probes = await probeProposals(missing, {
      proposals: ['resolvers', 'tunnels', 'contribViewsRemote'],
      viewIds: ['one'],
    });
    const alone = new FakeApi({commands: ['one.focus']});
    deepStrictEqual(
      [
        probes.map(probe => probe.state),
        missing.reads.includes('getCommands'),
        await stateOf(alone, 'contribViewsRemote', ['one']),
      ],
      [['missing', 'missing', 'missing'], true, 'granted'],
    );
  });

  it('F-1403: contribViewsRemote cannot be probed without a view to look for', async () => {
    const editor = new FakeApi({commands: ['one.focus']});
    deepStrictEqual(await stateOf(editor, 'contribViewsRemote'), 'unprobeable');
  });

  it('F-1403: contribViewsRemote cannot be probed when the commands cannot be listed', async () => {
    const editor = new FakeApi({commandsFail: true});
    deepStrictEqual(
      await stateOf(editor, 'contribViewsRemote', ['one']),
      'unprobeable',
    );
  });

  it('F-1403: contribRemoteHelp cannot be probed', async () => {
    deepStrictEqual(
      await stateOf(new FakeApi(), 'contribRemoteHelp'),
      'unprobeable',
    );
  });

  it('F-1403: extensionsAny cannot be probed', async () => {
    deepStrictEqual(
      await stateOf(new FakeApi(), 'extensionsAny'),
      'unprobeable',
    );
  });

  it('F-0101.BR-9: workspaceTrust, terminalDimensions and contribEditSessions cannot be probed, and no member is read', async () => {
    const editor = new FakeApi();
    const probes = await probeProposals(editor, {
      proposals: [
        'workspaceTrust',
        'terminalDimensions',
        'contribEditSessions',
      ],
      viewIds: [],
    });
    deepStrictEqual(
      [probes.map(probe => probe.state), editor.reads],
      [['unprobeable', 'unprobeable', 'unprobeable'], []],
    );
  });

  it('F-1403: the proposals come back in the order they were asked for', async () => {
    const probes = await probeProposals(new FakeApi(), {
      proposals: ['tunnels', 'resolvers', 'contribRemoteHelp'],
      viewIds: [],
    });
    deepStrictEqual(
      probes.map(probe => probe.proposal),
      ['tunnels', 'resolvers', 'contribRemoteHelp'],
    );
  });

  it('F-1403: a proposal that was not asked for is not touched', async () => {
    const editor = new FakeApi();
    await stateOf(editor, 'resolvers');
    deepStrictEqual(editor.reads, ['appCommit']);
  });

  it('F-1403: nothing is remembered between two probes', async () => {
    const editor = new FakeApi();
    await stateOf(editor, 'resolvers');
    await stateOf(editor, 'resolvers');
    deepStrictEqual(editor.reads, ['appCommit', 'appCommit']);
  });
});
