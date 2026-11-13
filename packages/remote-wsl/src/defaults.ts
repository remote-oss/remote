/**
 * @fileoverview The extension's named defaults: each bound a wait of the extension has, with what it rests on.
 */

/**
 * How long the activation waits for the machine's WSL presence (`wsl.exe --status`, then `--list --verbose`) before
 * it leaves the distro key unset: twice the slowest of ten cold runs of the two on the hosted Windows runner, rounded
 * up to the second.
 */
export const presenceBoundMilliseconds = 10_000;
