/**
 * @fileoverview Whether core stored the target type of the Remote Explorer, `remote.explorerType`, in the profile's
 * state database or in the state database of a workspace (F-5301 BR-5 to BR-10), read between the editor's writes.
 */

import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {variable} from './harness.ts';
import {readStateDatabase} from './state-database.ts';

/** Whether the state database `file` holds `remote.explorerType`. */
function holdsType(file: string): boolean {
  return (
    existsSync(file) &&
    readStateDatabase(
      file,
      database =>
        database
          .prepare('SELECT value FROM ItemTable WHERE key = ?')
          .all('remote.explorerType').length > 0,
    )
  );
}

/** Whether any state database of the launch, the profile's or a workspace's, holds `remote.explorerType`. */
export function anyTypeStored(): boolean {
  const user = path.join(variable('HARNESS_USER_DATA'), 'User');
  const workspaces = path.join(user, 'workspaceStorage');
  return [
    path.join(user, 'globalStorage', 'state.vscdb'),
    ...(existsSync(workspaces)
      ? readdirSync(workspaces).map(entry =>
          path.join(workspaces, entry, 'state.vscdb'),
        )
      : []),
  ].some(holdsType);
}
