import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {
  type CommandEntry,
  type CommandHost,
  registerCommands,
} from '../../src/index.ts';

const OPEN: CommandEntry = {
  id: 'remote-x.open',
  title: '%open%',
  palette: true,
  policy: 'infoLine',
};

const KILL: CommandEntry = {
  id: 'remote-x.kill',
  title: '%kill%',
  palette: true,
  policy: 'silent',
};

const COMMANDS = {open: OPEN, kill: KILL};

/** A command host that records registrations, information lines and disposals. */
class RecordingHost implements CommandHost {
  readonly callbacks = new Map<
    string,
    (...commandArguments: unknown[]) => unknown
  >();
  readonly outOfContext: string[] = [];
  readonly disposed: string[] = [];

  registerCommand(
    commandId: string,
    callback: (...commandArguments: unknown[]) => unknown,
  ) {
    this.callbacks.set(commandId, callback);
    return {dispose: () => this.disposed.push(commandId)};
  }

  showOutOfContext(entry: CommandEntry): void {
    this.outOfContext.push(entry.id);
  }

  invoke(commandId: string, ...commandArguments: unknown[]): unknown {
    return this.callbacks.get(commandId)?.(...commandArguments);
  }
}

describe('registerCommands', () => {
  let host: RecordingHost;
  let runs: unknown[][];

  function register(available: boolean): void {
    registerCommands(host, 'serving', COMMANDS, {
      open: {
        isAvailable: () => available,
        execute: (...commandArguments) => {
          runs.push(commandArguments);
          return 'opened';
        },
      },
      kill: {
        isAvailable: () => available,
        execute: () => 'killed',
      },
    });
  }

  beforeEach(() => {
    host = new RecordingHost();
    runs = [];
  });

  it('registers every command of the table under its id', () => {
    register(true);
    deepStrictEqual(
      [...host.callbacks.keys()],
      ['remote-x.open', 'remote-x.kill'],
    );
  });

  it('runs the handler with the invocation arguments when the command is available', () => {
    register(true);
    host.invoke('remote-x.open', 'first', 2);
    deepStrictEqual(runs, [['first', 2]]);
  });

  it("returns the handler's result when the command is available", () => {
    register(true);
    strictEqual(host.invoke('remote-x.open'), 'opened');
  });

  it('runs a handler without an availability predicate in every context', () => {
    registerCommands(
      host,
      'serving',
      {kill: KILL},
      {kill: {execute: () => 'killed'}},
    );
    strictEqual(host.invoke('remote-x.kill'), 'killed');
  });

  it('does nothing for a command invoked out of context (F-2006 BR-9)', () => {
    register(false);
    host.invoke('remote-x.open');
    deepStrictEqual(runs, []);
  });

  it('resolves to nothing for a command invoked out of context, never rejecting (F-2006 BR-9)', () => {
    register(false);
    strictEqual(host.invoke('remote-x.open'), undefined);
  });

  it('shows the information line once for an infoLine command out of context (F-2006 AC-22, F-5002 6.4)', () => {
    register(false);
    host.invoke('remote-x.open');
    deepStrictEqual(host.outOfContext, ['remote-x.open']);
  });

  it('shows nothing for a silent command out of context (F-2006 BR-9)', () => {
    register(false);
    host.invoke('remote-x.kill');
    deepStrictEqual(host.outOfContext, []);
  });

  it('shows nothing for a command invoked in context', () => {
    register(true);
    host.invoke('remote-x.open');
    deepStrictEqual(host.outOfContext, []);
  });

  it('disposes every registration through the one it returns', () => {
    registerCommands(host, 'serving', COMMANDS, {
      open: {execute: () => undefined},
      kill: {execute: () => undefined},
    }).dispose();
    deepStrictEqual(host.disposed, ['remote-x.open', 'remote-x.kill']);
  });

  it('refuses to register after the activation stood down (R-54 registration order)', () => {
    throws(
      () =>
        registerCommands(
          host,
          'standing',
          {kill: KILL},
          {kill: {execute: () => undefined}},
        ),
      {
        message:
          'registerCommands: an activation that stands down registers nothing',
      },
    );
  });

  it('fails for a command without a handler (contracts 1.2 MissingHandler)', () => {
    throws(
      () =>
        // @ts-expect-error: the table names a command the handlers leave out.
        registerCommands(host, 'serving', COMMANDS, {
          open: {execute: () => undefined},
        }),
      {message: "MissingHandler: command 'kill' has no handler"},
    );
  });

  it('registers no command when one has no handler', () => {
    let thrown = false;
    try {
      // @ts-expect-error: the table names a command the handlers leave out.
      registerCommands(host, 'serving', COMMANDS, {
        open: {execute: () => undefined},
      });
    } catch {
      thrown = true;
    }
    deepStrictEqual([thrown, [...host.callbacks.keys()]], [true, []]);
  });
});
