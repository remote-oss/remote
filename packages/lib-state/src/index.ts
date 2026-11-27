/**
 * @fileoverview lib-state: the state many windows of one profile add to, kept in files of an extension's global storage
 * folder, so that no window's write can drop another's. The editor's global state is one value that every window
 * rewrites whole from its own copy, which is why such records live here, in the folder a package is given as a path.
 */

export {
  type EventFiles,
  type EventStore,
  eventStoreOf,
  isRecord,
  newSession,
  NODE_EVENT_FILES,
  type TimedEvent,
  type Winner,
} from './event-files.ts';

export {
  type HandoffStore,
  handoffStoreOf,
  type TakenHandoff,
} from './handoffs.ts';
