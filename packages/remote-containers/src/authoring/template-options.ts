/**
 * @fileoverview The stage of the wizard that asks for the template's options: one screen for the value of each string
 * option, in the schema's order, then one screen for all the booleans. A template that declares no option shows nothing.
 * Back goes one screen back and reopens it fresh; Escape on a string screen ends the wizard, and on the booleans' screen
 * leaves every boolean unset.
 */

import {filled} from '../surfaces/filled.ts';
import {
  type BooleanScreen,
  pickBooleans,
  pickValue,
  type QuickInputPorts,
  type ValueScreen,
} from './option-screens.ts';
import type {
  StagePorts,
  WizardStage,
  WizardState,
  StageResult,
} from './wizard-stages.ts';

/** The English template of each text of the stage, by its string id. */
const OPTION_TEMPLATES = {
  S307: 'Select a value',
  S317: "Select the options for the '{0}' dev container",
} as const;

/** A screen of the stage, with the option or options it sets. */
type Screen =
  | {kind: 'string'; name: string; screen: ValueScreen}
  | {kind: 'booleans'; screen: BooleanScreen};

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((each): each is string => typeof each === 'string')
    : [];
}

/** Whether a declared default stands for true: the boolean, or the string the CLI's arguments spell it as. */
function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

/** The screen for the value of the string option `name`. */
function stringScreen(
  name: string,
  option: Record<string, unknown>,
  title: string,
  quick: QuickInputPorts,
): Screen {
  const choices = stringsOf(option.enum);
  const proposals = stringsOf(option.proposals);
  const fallback =
    typeof option.default === 'string' ? option.default : undefined;
  const strict = Array.isArray(option.enum);
  return {
    kind: 'string',
    name,
    screen: {
      title,
      placeholder:
        typeof option.description === 'string' && option.description !== ''
          ? option.description
          : quick.translate(OPTION_TEMPLATES.S307),
      values: strict
        ? choices
        : proposals.length > 0
          ? proposals
          : fallback === undefined
            ? []
            : [fallback],
      ...(fallback === undefined ? {} : {defaultValue: fallback}),
      strict,
      defaultFirst: true,
      finishButton: false,
    },
  };
}

/** The screens of a template's options: every string option first, then the booleans on one screen. */
function screensOf(state: WizardState, ports: StagePorts): Screen[] {
  const quick: QuickInputPorts = {...ports.options, translate: ports.translate};
  const options = Object.entries(state.template.options).map(
    ([name, option]) => [name, recordOf(option)] as const,
  );
  const strings = options
    .filter(([, option]) => option.type !== 'boolean')
    .filter(([, option]) => option.type === 'string' || 'enum' in option)
    .map(([name, option]) => stringScreen(name, option, ports.title, quick));
  const booleans = options.filter(([, option]) => option.type === 'boolean');
  return booleans.length === 0
    ? strings
    : [
        ...strings,
        {
          kind: 'booleans',
          screen: {
            title: ports.title,
            placeholder: filled(ports.translate, OPTION_TEMPLATES.S317, [
              state.template.name,
            ]),
            items: booleans.map(([name, option]) => ({
              key: name,
              label:
                typeof option.description === 'string' &&
                option.description !== ''
                  ? option.description
                  : name,
              checked: isTrue(option.default),
            })),
          },
        },
      ];
}

/** The stage that asks for the template's options. */
export function templateOptionsStage(ports: StagePorts): WizardStage {
  const quick: QuickInputPorts = {...ports.options, translate: ports.translate};
  return {
    name: 'templateOptions',
    execute: async (state, previous, cancellation): Promise<StageResult> => {
      const screens = screensOf(state, ports);
      if (screens.length === 0) {
        return {
          kind: 'next',
          state: {...state, templateArgs: {}},
          shown: false,
        };
      }
      const answers = new Map<number, Record<string, string>>();
      let index = 0;
      while (index < screens.length) {
        const current = screens[index];
        if (current === undefined) {
          break;
        }
        if (current.kind === 'string') {
          const answer = await pickValue(current.screen, quick, cancellation);
          if (answer.kind === 'escape') {
            return {kind: 'cancelled'};
          }
          if (answer.kind === 'back') {
            if (index === 0) {
              return {kind: 'back', keep: false};
            }
            index -= 1;
            answers.delete(index);
            continue;
          }
          answers.set(index, {[current.name]: answer.value});
        } else {
          const answer = await pickBooleans(
            current.screen,
            quick,
            cancellation,
          );
          if (answer.kind === 'back') {
            if (index === 0) {
              return {kind: 'back', keep: false};
            }
            index -= 1;
            answers.delete(index);
            continue;
          }
          const checked =
            answer.kind === 'values' ? answer.checked : new Set<string>();
          answers.set(
            index,
            Object.fromEntries(
              current.screen.items.map(item => [
                item.key,
                checked.has(item.key) ? 'true' : 'false',
              ]),
            ),
          );
        }
        index += 1;
      }
      const templateArgs = Object.assign({}, ...answers.values()) as Record<
        string,
        string
      >;
      return {kind: 'next', state: {...state, templateArgs}, shown: true};
    },
  };
}
