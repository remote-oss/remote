/**
 * @fileoverview lib-standdown: the activation guard of every extension package with code.
 */

export {type EditorApi, standDownHost} from './editor-adapter.ts';
export {
  type StandDownHost,
  standDownIfPresent,
  type StandDownOutcome,
  type StandDownRequest,
} from './stand-down.ts';
