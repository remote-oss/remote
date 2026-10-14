/**
 * @fileoverview Runs inside the dev container CLI's own process, before its code: Electron reads
 * `ELECTRON_RUN_AS_NODE` once, at start, so the CLI's children must not inherit it, or an Electron program they start
 * would run as plain Node.
 */

delete process.env.ELECTRON_RUN_AS_NODE;
