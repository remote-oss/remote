import {deepStrictEqual} from 'node:assert';
import {
  argvEntryList,
  decide,
  type GateInput,
  type ProbeReport,
} from '../../src/index.ts';

const OWN_ID = 'remote-oss.remote-ssh';
const EXPLORER_ID = 'remote-oss.remote-explorer';
const CONTAINERS_ID = 'remote-oss.remote-containers';

const GRANTED: ProbeReport = {proposal: 'resolvers', result: 'granted'};
const MISSING: ProbeReport = {proposal: 'tunnels', result: 'missing'};

function inputWith(changes: Partial<GateInput>): GateInput {
  return {
    extensionId: OWN_ID,
    probes: [GRANTED, MISSING],
    installedFamilyIds: [EXPLORER_ID, OWN_ID, CONTAINERS_ID],
    argvEnabled: [],
    dismissed: false,
    activationTime: true,
    windowClaimedBy: undefined,
    ...changes,
  };
}

describe('the decisions of the gate (card authority-03)', () => {
  it('F-1403: with every probe granted the extension proceeds, naming what is granted', () => {
    deepStrictEqual(
      decide(
        inputWith({
          probes: [GRANTED, {proposal: 'tunnels', result: 'granted'}],
        }),
      ),
      {kind: 'proceed', granted: ['resolvers', 'tunnels'], missing: []},
    );
  });

  it('F-1403: a missing proposal at activation after a dismissal proceeds, with the missing one listed', () => {
    deepStrictEqual(decide(inputWith({dismissed: true})), {
      kind: 'proceed',
      granted: ['resolvers'],
      missing: ['tunnels'],
    });
  });

  it('F-1403: a dismissal does not silence a failed use of a guarded member', () => {
    deepStrictEqual(
      decide(inputWith({dismissed: true, activationTime: false})).kind,
      'notify',
    );
  });

  it('F-1403: a window claimed by another extension keeps this one silent, with the missing listed', () => {
    deepStrictEqual(decide(inputWith({windowClaimedBy: EXPLORER_ID})), {
      kind: 'silent',
      missing: ['tunnels'],
    });
  });

  it('F-1403: the extension that holds the window notifies again', () => {
    deepStrictEqual(
      decide(inputWith({windowClaimedBy: OWN_ID})).kind,
      'notify',
    );
  });

  it('F-1403: with nothing claimed the extension notifies and claims the window', () => {
    deepStrictEqual(decide(inputWith({})), {
      kind: 'notify',
      claimWindow: true,
      argvEntries: [OWN_ID, EXPLORER_ID, CONTAINERS_ID],
      missing: ['tunnels'],
    });
  });

  it('F-1403: with the only installed id already enabled and a proposal still missing it notifies with no ids, and the runner applies the restart-only rule', () => {
    deepStrictEqual(
      decide(inputWith({installedFamilyIds: [OWN_ID], argvEnabled: [OWN_ID]})),
      {
        kind: 'notify',
        claimWindow: true,
        argvEntries: [],
        missing: ['tunnels'],
      },
    );
  });

  it('F-1403: a proposal that cannot be probed is neither granted nor missing', () => {
    deepStrictEqual(
      decide(
        inputWith({
          probes: [{proposal: 'contribRemoteHelp', result: 'unprobeable'}],
        }),
      ),
      {kind: 'proceed', granted: [], missing: []},
    );
  });
});

describe('the ids offered for the runtime arguments (card authority-03)', () => {
  const INSTALLED = [EXPLORER_ID, OWN_ID, CONTAINERS_ID];

  it('F-1403: this extension is first, then the others in the order given', () => {
    deepStrictEqual(argvEntryList(OWN_ID, INSTALLED, []), [
      OWN_ID,
      EXPLORER_ID,
      CONTAINERS_ID,
    ]);
  });

  it('F-1403: an id the runtime arguments already enable is not offered', () => {
    deepStrictEqual(argvEntryList(OWN_ID, INSTALLED, [OWN_ID]), [
      EXPLORER_ID,
      CONTAINERS_ID,
    ]);
  });

  it('F-1403: an id installed twice is offered once', () => {
    deepStrictEqual(
      argvEntryList(OWN_ID, [EXPLORER_ID, EXPLORER_ID, OWN_ID], []),
      [OWN_ID, EXPLORER_ID],
    );
  });

  it('F-1403: the bare switch and an empty id are never offered', () => {
    deepStrictEqual(argvEntryList(OWN_ID, ['*', '', EXPLORER_ID], []), [
      OWN_ID,
      EXPLORER_ID,
    ]);
  });

  for (const enabled of [[], [OWN_ID], [EXPLORER_ID, CONTAINERS_ID]]) {
    it(`F-1403: the ids of a notify decision are argvEntryList of its input, with ${String(enabled.length)} enabled`, () => {
      const input = inputWith({argvEnabled: enabled});
      const decision = decide(input);
      deepStrictEqual(
        decision.kind === 'notify' ? decision.argvEntries : undefined,
        argvEntryList(OWN_ID, input.installedFamilyIds, enabled),
      );
    });
  }
});
