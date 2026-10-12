import {deepStrictEqual} from 'node:assert';
import {
  type ProposalName,
  type ProposalProbe,
  type RestartAnswer,
  runSetup,
  type SetupAnswer,
  type SetupNotice,
  type SetupPorts,
} from '../../src/index.ts';

const OWN_ID = 'remote-oss.remote-ssh';
const SIBLING_ID = 'remote-oss.remote-explorer';

/** What the user and the editor do in a test. */
interface Scenario {
  missing?: readonly ProposalName[];
  unprobeable?: readonly ProposalName[];
  dismissed?: boolean;
  attemptPending?: boolean;
  holder?: string;
  claimSucceeds?: boolean;
  argvEnabled?: readonly string[];
  setupAnswer?: SetupAnswer;
  edited?: boolean;
  restartAnswer?: RestartAnswer;
  /** Names the port that rejects. */
  fails?: 'showSetup' | 'configure' | 'showRestart' | 'quit';
}

/** Fake ports that record what the setup did, in order. */
class FakePorts implements SetupPorts {
  readonly extensionId = OWN_ID;
  events: string[] = [];
  notices: SetupNotice[] = [];
  failures: string[] = [];
  dismissed: boolean;
  attemptPending: boolean;
  readonly flags = {
    dismissed: () => this.dismissed,
    setDismissed: (value: boolean) => {
      this.dismissed = value;
      this.events.push(`dismissed=${String(value)}`);
      return Promise.resolve();
    },
    attemptPending: () => this.attemptPending,
    setAttemptPending: (value: boolean) => {
      this.attemptPending = value;
      this.events.push(`pending=${String(value)}`);
      return Promise.resolve();
    },
  };
  readonly window = {
    claim: (extensionId: string) => {
      this.events.push('claim');
      if (this.scenario.holder !== undefined) {
        return Promise.resolve({holder: this.scenario.holder});
      }
      return Promise.resolve({
        holder: this.scenario.claimSucceeds === false ? undefined : extensionId,
      });
    },
  };
  private readonly scenario: Scenario;

  constructor(scenario: Scenario = {}) {
    this.scenario = scenario;
    this.dismissed = scenario.dismissed ?? false;
    this.attemptPending = scenario.attemptPending ?? false;
  }

  probe(): Promise<readonly ProposalProbe[]> {
    const missing = this.scenario.missing ?? [];
    const unprobeable = this.scenario.unprobeable ?? [];
    return Promise.resolve([
      {proposal: 'resolvers', state: 'granted'},
      ...missing.map((proposal): ProposalProbe => ({
        proposal,
        state: 'missing',
      })),
      ...unprobeable.map((proposal): ProposalProbe => ({
        proposal,
        state: 'unprobeable',
      })),
    ]);
  }

  installedFamilyIds(): readonly string[] {
    return [SIBLING_ID, OWN_ID];
  }

  argvEnabled(): Promise<readonly string[]> {
    return Promise.resolve(this.scenario.argvEnabled ?? []);
  }

  showSetup(notice: SetupNotice): Promise<SetupAnswer> {
    this.notices.push(notice);
    this.events.push(`show ${notice.kind}`);
    if (this.scenario.fails === 'showSetup') {
      return Promise.reject(new Error('the notification failed'));
    }
    return Promise.resolve(this.scenario.setupAnswer ?? 'notNow');
  }

  showRestart(): Promise<RestartAnswer> {
    this.events.push('show restart');
    if (this.scenario.fails === 'showRestart') {
      return Promise.reject(new Error('the restart notice failed'));
    }
    return Promise.resolve(this.scenario.restartAnswer ?? 'later');
  }

  configureRuntimeArguments(): PromiseLike<unknown> {
    this.events.push('configure');
    if (this.scenario.fails === 'configure') {
      return Promise.reject(new Error('the command failed'));
    }
    return Promise.resolve(undefined);
  }

  argvEdited(): Promise<boolean> {
    return Promise.resolve(this.scenario.edited ?? true);
  }

  logFailure(message: string): void {
    this.failures.push(message);
  }

  quit(): PromiseLike<unknown> {
    this.events.push('quit');
    if (this.scenario.fails === 'quit') {
      return Promise.reject(new Error('quitting failed'));
    }
    return Promise.resolve(undefined);
  }
}

async function settled(
  scenario: Scenario,
  activationTime = true,
): Promise<FakePorts> {
  const ports = new FakePorts(scenario);
  await (
    await runSetup(ports, activationTime)
  ).interaction;
  return ports;
}

describe('the proposed-API setup (F-1403)', () => {
  it('F-1403: with every proposal granted nothing is shown and the window is not claimed', async () => {
    const ports = await settled({});
    deepStrictEqual(ports.events, []);
  });

  it('F-1403: a probe that succeeds deletes the dismissal flag', async () => {
    const ports = await settled({dismissed: true});
    deepStrictEqual(ports.dismissed, false);
  });

  it('F-1403: a probe that succeeds deletes the pending-attempt flag', async () => {
    const ports = await settled({attemptPending: true});
    deepStrictEqual(ports.attemptPending, false);
  });

  it('F-1403: a proposal that cannot be probed is not a failure', async () => {
    const ports = await settled({unprobeable: ['contribRemoteHelp']});
    deepStrictEqual(ports.events, []);
  });

  it('F-1403: a missing proposal at activation shows the setup notice with this extension first', async () => {
    const ports = await settled({missing: ['tunnels']});
    deepStrictEqual(ports.notices, [
      {kind: 'setup', argvEntries: [OWN_ID, SIBLING_ID]},
    ]);
  });

  it('F-1403: the window is claimed before the notice is shown', async () => {
    const ports = await settled({missing: ['tunnels']});
    deepStrictEqual(ports.events.slice(0, 2), ['claim', 'show setup']);
  });

  it('F-1403: the ids the runtime arguments already enable are not offered again', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      argvEnabled: [SIBLING_ID],
    });
    deepStrictEqual(ports.notices, [{kind: 'setup', argvEntries: [OWN_ID]}]);
  });

  it('F-1403: another extension that holds the window keeps this one silent, after asking who holds it', async () => {
    const ports = await settled({missing: ['tunnels'], holder: SIBLING_ID});
    deepStrictEqual(ports.events, ['claim']);
  });

  it('F-1403: an extension that cannot find out who holds the window shows nothing', async () => {
    const ports = await settled({missing: ['tunnels'], claimSucceeds: false});
    deepStrictEqual(ports.events, ['claim']);
  });

  it('F-1403: a dismissed setup stays silent at activation', async () => {
    const ports = await settled({missing: ['tunnels'], dismissed: true});
    deepStrictEqual(ports.events, []);
  });

  it('F-1403: a dismissed setup does not silence a failed use of a guarded member', async () => {
    const ports = await settled({missing: ['tunnels'], dismissed: true}, false);
    deepStrictEqual(ports.notices.length, 1);
  });

  it('F-1403: "not now" stores the dismissal and does nothing else', async () => {
    const ports = await settled({missing: ['tunnels'], setupAnswer: 'notNow'});
    deepStrictEqual(ports.events, ['claim', 'show setup', 'dismissed=true']);
  });

  it('F-1403: "configure" opens the runtime arguments', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      setupAnswer: 'configure',
      edited: false,
    });
    deepStrictEqual(ports.events, ['claim', 'show setup', 'configure']);
  });

  it('F-1403: a save-and-close of the runtime arguments is remembered and the restart is offered', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      setupAnswer: 'configure',
      edited: true,
    });
    deepStrictEqual(ports.events.slice(-3), [
      'configure',
      'pending=true',
      'show restart',
    ]);
  });

  it('F-1403: "quit" at the restart notice quits the editor', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      setupAnswer: 'configure',
      restartAnswer: 'quit',
    });
    deepStrictEqual(ports.events.at(-1), 'quit');
  });

  it('F-1403: "later" at the restart notice quits nothing', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      setupAnswer: 'configure',
      restartAnswer: 'later',
    });
    deepStrictEqual(ports.events.includes('quit'), false);
  });

  it('F-1403: after an edit that did not take effect the failed-attempt notice shows, whatever the dismissal says', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      attemptPending: true,
      dismissed: true,
    });
    deepStrictEqual(ports.notices, [{kind: 'failedAttempt'}]);
  });

  it('F-1403: a flag that is not set is not written', async () => {
    const ports = await settled({});
    deepStrictEqual(ports.events, []);
  });

  it('F-1403: the pending-attempt flag is cleared when the failed-attempt notice shows', async () => {
    const ports = await settled({missing: ['tunnels'], attemptPending: true});
    deepStrictEqual(ports.attemptPending, false);
  });

  it('F-1403: "not now" at the failed-attempt notice stores the dismissal', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      attemptPending: true,
      setupAnswer: 'notNow',
    });
    deepStrictEqual(ports.dismissed, true);
  });

  it('F-1403: an extension the runtime arguments already list offers only the restart', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      argvEnabled: [OWN_ID],
    });
    deepStrictEqual(ports.events, ['claim', 'show restart']);
  });

  it('F-1403: the restart offered for a listed extension quits when accepted', async () => {
    const ports = await settled({
      missing: ['tunnels'],
      argvEnabled: [OWN_ID],
      restartAnswer: 'quit',
    });
    deepStrictEqual(ports.events.at(-1), 'quit');
  });

  it('F-1403: the activation does not wait for the user', async () => {
    const ports = new FakePorts({missing: ['tunnels']});
    ports.showSetup = () => new Promise<SetupAnswer>(() => undefined);
    const outcome = await runSetup(ports, true);
    deepStrictEqual(outcome.decision.kind, 'notify');
  });

  it('F-1403: every call probes again and nothing is remembered between two', async () => {
    const ports = new FakePorts({missing: ['tunnels'], holder: SIBLING_ID});
    await runSetup(ports, true);
    const second = await runSetup(ports, true);
    deepStrictEqual(second.decision.kind, 'silent');
  });

  const BROKEN_PORTS = [
    ['showSetup', 'the notification failed'],
    ['configure', 'the command failed'],
    ['showRestart', 'the restart notice failed'],
    ['quit', 'quitting failed'],
  ] as const;
  for (const [port, message] of BROKEN_PORTS) {
    it(`F-1403: when ${port} rejects the interaction settles as failed`, async () => {
      const ports = new FakePorts({
        missing: ['tunnels'],
        setupAnswer: 'configure',
        restartAnswer: 'quit',
        fails: port,
      });
      deepStrictEqual(
        await (
          await runSetup(ports, true)
        ).interaction,
        'failed',
      );
    });

    it(`F-1403: when ${port} rejects the failure is logged once`, async () => {
      const ports = new FakePorts({
        missing: ['tunnels'],
        setupAnswer: 'configure',
        restartAnswer: 'quit',
        fails: port,
      });
      await (
        await runSetup(ports, true)
      ).interaction;
      deepStrictEqual(ports.failures, [`the setup was given up: ${message}`]);
    });
  }

  it('F-1403: a port that rejects with something that is not an error is logged by its text', async () => {
    const ports = new FakePorts({missing: ['tunnels']});
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a port that breaks its contract, on purpose
    ports.showSetup = () => Promise.reject('refused as text');
    await (
      await runSetup(ports, true)
    ).interaction;
    deepStrictEqual(ports.failures, [
      'the setup was given up: refused as text',
    ]);
  });

  it('F-1403: the restart offered for a listed extension is guarded too', async () => {
    const ports = new FakePorts({
      missing: ['tunnels'],
      argvEnabled: [OWN_ID],
      fails: 'showRestart',
    });
    deepStrictEqual(await (await runSetup(ports, true)).interaction, 'failed');
  });

  it('F-1403: an interaction that ran to its end settles as finished', async () => {
    const ports = new FakePorts({missing: ['tunnels']});
    deepStrictEqual(
      await (
        await runSetup(ports, true)
      ).interaction,
      'finished',
    );
  });
});
