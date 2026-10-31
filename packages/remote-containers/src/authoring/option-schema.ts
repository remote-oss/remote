/**
 * @fileoverview What the option screens read of an option's declaration in a template's or a Feature's schema: the
 * record, the lists of text, the default that stands for true, and the text a screen shows for the option.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The English template of the text a screen shows for an option that has no description, by its string id. */
const SCHEMA_TEMPLATES = {S307: 'Select a value'} as const;

/** An option's declaration as a record; an empty one for anything else. */
export function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The members of an array that are text; none for anything else. */
export function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((each): each is string => typeof each === 'string')
    : [];
}

/** Whether a declared default stands for true: the boolean, or the string the CLI's arguments spell it as. */
export function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

/** The option's description when it has a non-empty one. */
export function descriptionOf(
  option: Record<string, unknown>,
): string | undefined {
  return typeof option.description === 'string' && option.description !== ''
    ? option.description
    : undefined;
}

/** The placeholder of an option's value screen: its description, or S307 when it has none. */
export function placeholderOf(
  option: Record<string, unknown>,
  translate: Translate,
): string {
  return descriptionOf(option) ?? translate(SCHEMA_TEMPLATES.S307);
}
