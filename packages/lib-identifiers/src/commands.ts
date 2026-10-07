/**
 * @fileoverview Registers a package's commands from its identifier table. Each handler runs behind a guard: a
 * command invoked where it cannot act does nothing, and a command whose policy asks for it also shows one
 * information line naming its title.
 */

/** A command of a package's identifier table. */
export interface CommandEntry {
  readonly id: string;
  /** The title as the manifest writes it, a `%key%` placeholder included. */
  readonly title: string;
  readonly palette: boolean;
  /** What an invocation out of context shows: nothing, or one information line. */
  readonly policy: 'silent' | 'infoLine';
}

/** What a package supplies for one command. */
export interface CommandHandler {
  /** Whether the window's current context lets the command act; a handler without it always acts. */
  readonly isAvailable?: () => boolean;
  /** Runs the command with the arguments it was invoked with. */
  readonly execute: (...commandArguments: unknown[]) => unknown;
}

/** Something registered that can be undone. */
export interface Registration {
  dispose(): unknown;
}

/** The editor operations that command registration needs. */
export interface CommandHost {
  /** Registers `callback` under the command id. */
  registerCommand(
    commandId: string,
    callback: (...commandArguments: unknown[]) => unknown,
  ): Registration;
  /** Shows the information line for a command invoked out of context, without waiting for it to close. */
  showOutOfContext(entry: CommandEntry): void;
}

/** What the stand-down guard decided at the start of activation. */
export type ActivationOutcome = 'standing' | 'serving';

function guarded(
  host: CommandHost,
  entry: CommandEntry,
  handler: CommandHandler,
): (...commandArguments: unknown[]) => unknown {
  return (...commandArguments) => {
    if (handler.isAvailable?.() !== false) {
      return handler.execute(...commandArguments);
    }
    if (entry.policy === 'infoLine') {
      host.showOutOfContext(entry);
    }
    return undefined;
  };
}

/**
 * Registers every command of `commands` with its handler from `handlers`, each behind the out-of-context guard,
 * and returns one registration that undoes them all. Throws when the activation stands down, since nothing may be
 * registered then, and when a command has no handler, before registering any; both are programming errors.
 */
export function registerCommands<
  Commands extends Readonly<Record<string, CommandEntry>>,
>(
  host: CommandHost,
  outcome: ActivationOutcome,
  commands: Commands,
  handlers: {readonly [Name in keyof Commands]: CommandHandler},
): Registration {
  if (outcome === 'standing') {
    throw new Error(
      'registerCommands: an activation that stands down registers nothing',
    );
  }
  const handlerByName = new Map<string, CommandHandler>(
    Object.entries(handlers),
  );
  const guardedCommands = Object.entries(commands).map(([name, entry]) => {
    const handler = handlerByName.get(name);
    if (handler === undefined) {
      throw new Error(`MissingHandler: command '${name}' has no handler`);
    }
    return {entry, handler};
  });
  const registrations = guardedCommands.map(({entry, handler}) =>
    host.registerCommand(entry.id, guarded(host, entry, handler)),
  );
  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose();
      }
    },
  };
}
