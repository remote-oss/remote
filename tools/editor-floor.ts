/**
 * @fileoverview The oldest editor version every extension supports (ADR-0007) and the Node.js version it runs on.
 */

/** The editor version the acceptance run's tests run on: the recorded version of ADR-0007. */
export const EDITOR_VERSION = '1.139.1';

/** The versions of VS Code the genuine launches may run, by the job's choice: the recorded version and the floor. */
export const GENUINE_VERSIONS: readonly string[] = [EDITOR_VERSION, '1.125.0'];

/** `engines.vscode` of every extension manifest; tools/check-layout verifies each one against it. */
export const EDITOR_ENGINE = '^1.125.0';

/**
 * The esbuild target: the Node.js version of VS Code 1.125, the floor. VS Code OSS tag 1.125.0 builds on Electron
 * 42.3.0, which ships Node.js 24.15.0.
 */
export const NODE_TARGET = 'node24';
