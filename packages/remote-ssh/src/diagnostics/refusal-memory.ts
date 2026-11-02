/**
 * @fileoverview What the extension remembers of the refusals it has told the log about: the shared connections whose
 * refusal was logged, kept in the global state so that a reload of the window does not tell it again.
 */

/** The global-state key the connections are kept under. */
export const REFUSAL_MEMORY_KEY = 'remote.ssh.refusalsLogged';

/** How many connections are remembered, the oldest forgotten first. */
const CONNECTIONS_KEPT = 20;

/** The global-state port the memory reads and writes through. */
export interface RefusalMemoryState {
  get(key: string): readonly string[] | undefined;
  update(key: string, value: readonly string[]): PromiseLike<void>;
}

/** The connections whose refusal was logged. */
export interface RefusalMemory {
  /** Whether the refusal of the shared connection `connection` was logged. */
  contains(connection: string): boolean;
  /** Remembers that the refusal of `connection` was logged. */
  remember(connection: string): void;
}

/** The memory over `state`. */
export function refusalMemoryOf(state: RefusalMemoryState): RefusalMemory {
  return {
    contains: connection =>
      (state.get(REFUSAL_MEMORY_KEY) ?? []).includes(connection),
    remember: connection => {
      const kept = (state.get(REFUSAL_MEMORY_KEY) ?? []).filter(
        each => each !== connection,
      );
      void Promise.resolve(
        state.update(
          REFUSAL_MEMORY_KEY,
          [...kept, connection].slice(-CONNECTIONS_KEPT),
        ),
      ).catch(() => undefined);
    },
  };
}
