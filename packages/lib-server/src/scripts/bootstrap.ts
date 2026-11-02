/**
 * @fileoverview The bootstrap script of each step, for the interpreter the host has: the POSIX `sh` script for every
 * step, and the PowerShell script for the steps it has; any other step answers a PowerShell host with a clear failure.
 */

import type {Interpreter} from 'lib-host';
import {posixScript} from './posix-script.ts';
import {POWERSHELL_STEPS, powershellScript} from './powershell-script.ts';
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

/** What a PowerShell host gets for a step the PowerShell script doesn't have yet: a block that names the gap. */
const POWERSHELL_UNAVAILABLE: string = [
  `Write-Output ''`,
  `Write-Output '${RESULT_BEGIN}'`,
  `Write-Output 'status=ServerFailedToStart'`,
  `Write-Output 'host.note=the Windows bootstrap script is not available yet'`,
  `Write-Output '${RESULT_END}'`,
  '',
].join('\n');

/**
 * The text of the script for one step, for the interpreter the host has. Both scripts print a result block that
 * `parseResult` reads; a step the PowerShell script doesn't have yet answers with a failure that says so.
 */
export function scriptFor(
  request: BootstrapRequest,
  interpreter: Interpreter,
  parameters: ScriptParameters,
): string {
  if (interpreter === 'posixShell') {
    return posixScript(request, parameters);
  }
  return POWERSHELL_STEPS.has(request.step)
    ? powershellScript(request, parameters)
    : POWERSHELL_UNAVAILABLE;
}
