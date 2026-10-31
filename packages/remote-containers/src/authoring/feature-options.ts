/**
 * @fileoverview The stage of the wizard that asks for the options of the Features chosen: the choice between keeping
 * every Feature's defaults and configuring them, then a walk through each Feature that declares an option, its booleans
 * on one screen first and then each of its string options that offers a list of values. A Feature's entry holds what the
 * walk gave: a boolean only when it is true, and a string whenever its screen was shown.
 */

import {filled} from '../surfaces/filled.ts';
import type {CatalogueFeature} from './catalogue.ts';
import {
  descriptionOf,
  isTrue,
  placeholderOf,
  recordOf,
  stringsOf,
} from './option-schema.ts';
import {
  pickBooleans,
  pickValue,
  type QuickInputPorts,
  type ValueScreen,
} from './option-screens.ts';
import type {FeatureChoice} from './select-features.ts';

/** The English template of each text of the stage, by its string id. */
const FEATURE_OPTION_TEMPLATES = {
  S084: 'Configure Options',
  S216: 'Keep Defaults',
  S217: 'Keep Feature defaults or configure options?',
  S310: "Select boolean options for '{0}'",
  S311: 'Select boolean options for {0}',
  S313: "Select options for '{0}'",
} as const;

/** A Feature the user chose, with what the catalogue declares of it. */
export interface ChosenFeature {
  choice: FeatureChoice;
  feature: CatalogueFeature;
}

/** How the stage ends. */
export type FeatureOptionsAnswer =
  /** `shown` false: nothing was asked, and every Feature keeps the entry it had. */
  | {kind: 'chosen'; features: FeatureChoice[]; shown: boolean}
  /** Back from the gate or the walk: Select Features opens again from the start. */
  | {kind: 'back'}
  | {kind: 'cancelled'};

/** What a Feature's walk ended with. */
type WalkEnd =
  | {kind: 'entry'; options: Record<string, string | boolean>}
  | {kind: 'back'}
  | {kind: 'cancelled'};

/** The declarations of a Feature's options, in the schema's order. */
function declarationsOf(
  feature: CatalogueFeature,
): Array<[string, Record<string, unknown>]> {
  return Object.entries(feature.options).map(
    ([name, option]) =>
      [name, recordOf(option)] as [string, Record<string, unknown>],
  );
}

/** Whether a Feature declares any option at all. */
function declaresOptions(feature: CatalogueFeature): boolean {
  return Object.keys(feature.options).length > 0;
}

/** The values a string option offers: its enum, else its proposals; none for a plain string. */
function valuesOf(option: Record<string, unknown>): string[] {
  const choices = stringsOf(option.enum);
  return Array.isArray(option.enum) ? choices : stringsOf(option.proposals);
}

/** The screen of one string option of a Feature. */
function valueScreenOf(
  feature: CatalogueFeature,
  option: Record<string, unknown>,
  quick: QuickInputPorts,
): ValueScreen {
  return {
    title: filled(quick.translate, FEATURE_OPTION_TEMPLATES.S313, [
      feature.name,
    ]),
    placeholder: placeholderOf(option, quick.translate),
    values: valuesOf(option),
    ...(typeof option.default === 'string'
      ? {defaultValue: option.default}
      : {}),
    strict: Array.isArray(option.enum),
    defaultFirst: false,
    finishButton: true,
  };
}

/** Walks one Feature: its booleans on one screen, then each string option that offers values. */
async function walked(
  feature: CatalogueFeature,
  quick: QuickInputPorts,
  cancellation: AbortSignal,
): Promise<WalkEnd> {
  const declared = declarationsOf(feature);
  const booleans = declared.filter(([, option]) => option.type === 'boolean');
  const options: Record<string, string | boolean> = {};
  if (booleans.length > 0) {
    const answer = await pickBooleans(
      {
        title: filled(quick.translate, FEATURE_OPTION_TEMPLATES.S310, [
          feature.name,
        ]),
        placeholder: filled(quick.translate, FEATURE_OPTION_TEMPLATES.S311, [
          feature.name,
        ]),
        finishButton: true,
        items: booleans.map(([name, option]) => ({
          key: name,
          label: name,
          ...(descriptionOf(option) === undefined
            ? {}
            : {description: descriptionOf(option) ?? ''}),
          checked: isTrue(option.default),
        })),
      },
      quick,
      cancellation,
    );
    if (answer.kind === 'back') {
      return {kind: 'back'};
    }
    if (answer.kind === 'escape') {
      return {kind: 'cancelled'};
    }
    for (const [name] of booleans) {
      if (answer.checked.has(name)) {
        options[name] = true;
      }
    }
  }
  for (const [name, option] of declared) {
    if (option.type === 'boolean' || valuesOf(option).length === 0) {
      continue;
    }
    const answer = await pickValue(
      valueScreenOf(feature, option, quick),
      quick,
      cancellation,
    );
    if (answer.kind === 'back') {
      return {kind: 'back'};
    }
    if (answer.kind === 'escape') {
      return {kind: 'cancelled'};
    }
    if (answer.value !== '') {
      options[name] = answer.value;
    }
    if (answer.kind === 'finish') {
      break;
    }
  }
  return {kind: 'entry', options};
}

/** Asks whether to keep the defaults; Escape goes on to configure. */
async function keepsDefaults(
  quick: QuickInputPorts,
  cancellation: AbortSignal,
): Promise<boolean> {
  const keep = quick.translate(FEATURE_OPTION_TEMPLATES.S216);
  const answer = await pickValue(
    {
      title: quick.translate(FEATURE_OPTION_TEMPLATES.S217),
      placeholder: '',
      values: [keep, quick.translate(FEATURE_OPTION_TEMPLATES.S084)],
      strict: true,
      defaultFirst: false,
      finishButton: false,
      bare: true,
    },
    quick,
    cancellation,
  );
  return answer.kind === 'value' && answer.value === keep;
}

/**
 * Asks for the options of `chosen`, in the order given. `configure` is how Select Features was confirmed: with Finish
 * nothing is asked. The entries start from the schema's defaults, never from an earlier answer.
 */
export async function askFeatureOptions(
  chosen: readonly ChosenFeature[],
  configure: boolean,
  quick: QuickInputPorts,
  cancellation: AbortSignal,
): Promise<FeatureOptionsAnswer> {
  const bare = chosen.map(each => ({id: each.choice.id, options: {}}));
  if (!configure || !chosen.some(each => declaresOptions(each.feature))) {
    return {kind: 'chosen', features: bare, shown: false};
  }
  if (await keepsDefaults(quick, cancellation)) {
    return {kind: 'chosen', features: bare, shown: true};
  }
  const features: FeatureChoice[] = [];
  for (const each of chosen) {
    const end = declaresOptions(each.feature)
      ? await walked(each.feature, quick, cancellation)
      : ({kind: 'entry', options: {}} as const);
    if (end.kind !== 'entry') {
      return {kind: end.kind};
    }
    features.push({id: each.choice.id, options: end.options});
  }
  return {kind: 'chosen', features, shown: true};
}
