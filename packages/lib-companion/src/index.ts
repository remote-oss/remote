/**
 * @fileoverview lib-companion: the plain-data messages that Remote Explorer and the extensions that serve it
 * exchange: the version envelope, the payload shapes, and the rules that read them. The call protocol runs over
 * a command bus and a clock that the extension passes in; only the editor adapter knows the editor's API.
 */

export * from './detector.ts';
export * from './editor-adapter.ts';
export * from './endpoints.ts';
export * from './payloads.ts';
export * from './protocol.ts';
export {hostKeyOfAuthority, isConfiguredAlias} from './host-key.ts';
export {removeFolderCopies, type RemovalOutcome} from './history.ts';
