/**
 * @fileoverview The host picker's model and the result of a pick: the listed hosts, the typed text, and the two
 * fixed rows, plus what a picked row hands to the connect flow.
 */

import type {HostListResult, SshTarget} from 'lib-ssh';
import {parseTypedHost} from './typed-input.ts';

/** A string-table reference: the key and the values it stands for, as the editor shows them. */
export interface StringRef {
  id: string;
  values: string[];
}

/** One row of the picker: a listed host, the typed text, or one of the two fixed rows. */
export type PickerItem =
  | {kind: 'host'; label: string; keepVisible: boolean}
  | {kind: 'typed'; label: string; text: string; keepVisible: true}
  | {kind: 'addHost'; label: StringRef; keepVisible: true}
  | {kind: 'configure'; label: StringRef; keepVisible: true};

/** The picker the user sees: its placeholder and its rows in order. */
export interface PickerModel {
  placeholder: StringRef;
  items: PickerItem[];
}

/** The marker a typed row carries in front of its text, alone when the text is only whitespace. */
const TYPED_MARKER = '➤';

/**
 * The picker for a host listing and the typed text: the listed hosts in order, the typed row when there is a text,
 * and the two fixed rows. A listing that could not be parsed is returned as the same parse error.
 */
export function pickerModel(
  listing: HostListResult,
  typedText: string,
): PickerModel | {parseError: {file: string; reason: string}} {
  if ('parseError' in listing) {
    return {parseError: listing.parseError};
  }
  const whitespaceOnly = typedText !== '' && typedText.trim() === '';
  const items: PickerItem[] = listing.hosts.map(entry => ({
    kind: 'host',
    label: entry.name,
    keepVisible: whitespaceOnly,
  }));
  if (typedText !== '') {
    items.push({
      kind: 'typed',
      label: whitespaceOnly ? TYPED_MARKER : `${TYPED_MARKER} ${typedText}`,
      text: typedText,
      keepVisible: true,
    });
  }
  items.push({
    kind: 'addHost',
    label: {id: 'S167', values: ['$(plus)']},
    keepVisible: true,
  });
  items.push({
    kind: 'configure',
    label: {id: 'S024', values: []},
    keepVisible: true,
  });
  return {
    placeholder: {id: 'S127', values: []},
    items,
  };
}

/** What a picked row hands to the connect flow: a connection target, or the hand-over of a fixed row. */
export type PickOutcome =
  {connect: SshTarget} | {handOver: 'addHost' | 'configure'};

/** The result of a pick: a host connects to its alias, a typed text is parsed, a fixed row hands over. */
export function outcomeOfPick(item: PickerItem): PickOutcome {
  if (item.kind === 'host') {
    return {connect: {host: item.label}};
  }
  if (item.kind === 'typed') {
    return {connect: parseTypedHost(item.text)};
  }
  if (item.kind === 'addHost') {
    return {handOver: 'addHost'};
  }
  return {handOver: 'configure'};
}
