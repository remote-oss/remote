/**
 * @fileoverview lib-server: the editor's server on a host, installed and started through a host
 * channel. A package hands the library one flat policy record per extension; the library never
 * branches on which extension calls it.
 */

export {
  type Cleanup,
  type DownloadPlacement,
  type ExtraStartOption,
  type InstallMode,
  type Prefetch,
  type PolicyProblem,
  type RequirementsCheck,
  type ServerPolicyRecord,
  type Verification,
} from './policy/record.ts';
export {CONTAINERS_POLICY, SSH_POLICY, wslPolicy} from './policy/rows.ts';
export {validatePolicyRecord} from './policy/validate.ts';
