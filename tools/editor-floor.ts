/**
 * @fileoverview The oldest editor version every extension supports (ADR-0007) and the Node.js version it runs on.
 */

/** `engines.vscode` of every extension manifest; tools/check-layout verifies each one against it. */
export const EDITOR_ENGINE = '^1.139.0';

/**
 * The esbuild target: the Node.js version of VS Code 1.139, the floor. VS Code OSS tag 1.139.1 builds on Electron
 * 43.6.0 (`.npmrc` `target`), which ships Node.js 24.20.0, and its server on Node.js 24.20.0 (`remote/.npmrc`).
 */
export const NODE_TARGET = 'node24';
