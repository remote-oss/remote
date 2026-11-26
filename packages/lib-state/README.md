# lib-state

Internal library, bundled into the extensions that use it and never published on its own. It keeps the state that
many windows of one profile add to in files of an extension's own global storage folder, which the package is given as
a path: the editor's global state is one value that every window rewrites whole from its own copy, so a window whose copy
lacks another window's write drops it.

- **The event files** (`eventStoreOf`): each window writes only its own file `<session>.json` of a folder, whole, under a
  temporary name renamed over it. A read merges every window's file, the newest event of each key deciding, and of two
  events of one time the one of the later session. A file untouched for a day is folded into a writer's own after the
  writer claims it by a rename; leftovers of a write that was never renamed are removed. The package that uses it gives
  the key of an event, how a file's value becomes one, the layer an earlier version kept elsewhere and, when it wants,
  which of its own events a write keeps.
- **The handoffs** (`handoffStoreOf`): what a window leaves for the next one to take once, across a reload or a restart,
  one file for each handoff in a folder of its kind, named by a hash of its key. The taker claims the file by renaming it
  to a name of its own, which only one of several windows that activate at once can do, then reads it and deletes it. A
  handoff older than its lifetime, dated in the future or not a value its taker accepts is deleted and taken by none. A
  handoff can also be peeked, which reads it as the taker would and leaves it where it is.
- **The file port** (`EventFiles`, `NODE_EVENT_FILES`): the operations both stores use, which a row replaces;
  `lib-state/testing/memory-files` is the port in memory.

It imports neither the editor nor any other library of the family.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-state` (`src/index.ts`), `lib-state/testing/memory-files` |
| Allowed imports | none: Node's own modules only; no `vscode`, no other library |
| Coverage exclusions | none |
