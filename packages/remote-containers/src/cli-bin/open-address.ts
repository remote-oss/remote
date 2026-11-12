/**
 * @fileoverview The address `devcontainer open` hands the editor the dev container authority, whose
 * hex holds the folder, or the folder and the configuration file named by `--config`, and the path inside the container.
 * Spaces, `$` and quotes of the folder are kept; the path is percent-encoded so that none of them cuts it.
 */

import type {OpenPlan} from './open-plan.ts';

/** The scheme of a remote window's folder address; the editor's own, whatever the product is called. */
const REMOTE_SCHEME = 'vscode-remote';

/** The address of the window `plan` opens. */
export function openAddressOf(plan: OpenPlan): string {
  const payload =
    plan.configFile === undefined
      ? plan.folder
      : JSON.stringify({
          hostPath: plan.folder,
          configFile: {$mid: 1, path: plan.configFile, scheme: 'file'},
        });
  const authority = Buffer.from(payload, 'utf8').toString('hex');
  const path = plan.workspacePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${REMOTE_SCHEME}://dev-container%2B${authority}${path}`;
}
