/**
 * @fileoverview lib-identifiers: the behaviour shared over the identifier tables of the extension packages.
 */

export {
  type ActivationOutcome,
  type CommandEntry,
  type CommandHandler,
  type CommandHost,
  type Registration,
  registerCommands,
} from './commands.ts';
export {
  type ContextKeyEntry,
  type ContextKeyHost,
  setContextKey,
} from './context-keys.ts';
export {
  type CommandManifest,
  type EditorApi,
  identifierHost,
  type IdentifierHost,
} from './editor-adapter.ts';
export {
  readSetting,
  type SettingEntry,
  type SettingHost,
  type SettingInspection,
} from './settings.ts';
