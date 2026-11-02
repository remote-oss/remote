/**
 * @fileoverview The bootstrap script of each step, for the interpreter the host has. Only the POSIX `sh` script exists;
 * the PowerShell script answers with a clear failure until it has been captured on a Windows host.
 */

import type {Interpreter} from 'lib-host';
import {posixScript} from './posix-script.ts';
import {RESULT_BEGIN, RESULT_END} from './result-block.ts';
import type {BootstrapRequest, ScriptParameters} from './steps.ts';

export type {
  BootstrapRequest,
  ProxyVariables,
  ScriptParameters,
  ScriptStep,
  StartParameters,
  StepwiseAction,
} from './steps.ts';

/** What the PowerShell twin prints until it exists: a result block that names the missing piece. */
const POWERSHELL_UNAVAILABLE: string = [
  `Write-Output ''`,
  `Write-Output '${RESULT_BEGIN}'`,
  `Write-Output 'status=ServerFailedToStart'`,
  `Write-Output 'host.note=the Windows bootstrap script is not available yet'`,
  `Write-Output '${RESULT_END}'`,
  '',
].join('\n');

/**
 * The text of the script for one step, for the interpreter the host has. The POSIX script runs under any `sh` and
 * prints a result block that `parseResult` reads. The PowerShell script is provisional until it has been captured on
 * a Windows host, so it answers with a failure that says so.
 */
export function scriptFor(
  request: BootstrapRequest,
  interpreter: Interpreter,
  parameters: ScriptParameters,
): string {
  return interpreter === 'powershell'
    ? POWERSHELL_UNAVAILABLE
    : posixScript(request, parameters);
}
