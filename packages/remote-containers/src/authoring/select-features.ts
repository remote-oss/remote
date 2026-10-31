/**
 * @fileoverview The stage of the wizard that asks which Features to install: one multi-select screen over the
 * catalogue's Features, sorted by label, with nothing checked unless the user comes back to it. Finish and OK both end it
 * with what is checked; they differ in the mode they leave for the stages after it.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {CatalogueFeature} from './catalogue.ts';
import {
  type BooleanAnswer,
  pickBooleans,
  type QuickInputPorts,
} from './option-screens.ts';

/** The English template of each text of the stage, by its string id. */
const FEATURE_TEMPLATES = {
  S301: 'Select Features',
  S308: 'Select additional features to install',
  S183: 'Finish',
} as const;

/** The owner whose Features carry the verified icon. */
const VERIFIED_OWNER = 'devcontainers';

/** A Feature the user chose, with its options. */
export interface FeatureChoice {
  /** The id with its major version, as the CLI writes the key. */
  id: string;
  options: Record<string, string | boolean>;
}

/** What the stage needs: the quick input the screen is made with. */
export interface FeaturesPorts {
  quick: QuickInputPorts;
}

/** How the stage ends. */
export type FeaturesAnswer =
  | {kind: 'chosen'; features: FeatureChoice[]; mode: 'defaults' | 'configure'}
  | {kind: 'back'}
  | {kind: 'cancelled'};

const COLLATOR = new Intl.Collator('en', {sensitivity: 'base'});

/** The Features in the order the screen lists them: by label, ignoring case and accents, then by code units. */
export function sortedFeatures(
  features: readonly CatalogueFeature[],
): CatalogueFeature[] {
  return [...features].sort(
    (left, right) =>
      COLLATOR.compare(left.name, right.name) ||
      Number(left.name > right.name) - Number(left.name < right.name),
  );
}

/** The key a Feature is written under: its id with the major of its version. */
export function featureKeyOf(feature: CatalogueFeature): string {
  return `${feature.id}:${feature.version.split('.', 1).join('')}`;
}

/** The tooltip of the Finish button of the screen. */
export function finishTooltip(translate: Translate): string {
  return translate(FEATURE_TEMPLATES.S183);
}

function text(translate: Translate, template: string): string {
  return translate(template);
}

/**
 * Asks which of `features` to install. `previous` are the Features checked when the user comes back to the screen.
 */
export async function askFeatures(
  features: readonly CatalogueFeature[],
  previous: readonly FeatureChoice[],
  ports: FeaturesPorts,
  cancellation: AbortSignal,
): Promise<FeaturesAnswer> {
  const listed = sortedFeatures(features);
  const kept = new Set(previous.map(each => each.id));
  const answer: BooleanAnswer = await pickBooleans(
    {
      title: text(ports.quick.translate, FEATURE_TEMPLATES.S301),
      placeholder: text(ports.quick.translate, FEATURE_TEMPLATES.S308),
      finishButton: true,
      items: listed.map(feature => ({
        key: featureKeyOf(feature),
        label: feature.name,
        ...(feature.owner === undefined ? {} : {description: feature.owner}),
        checked: kept.has(featureKeyOf(feature)),
        verified: feature.owner === VERIFIED_OWNER,
      })),
    },
    ports.quick,
    cancellation,
  );
  if (answer.kind === 'back') {
    return {kind: 'back'};
  }
  if (answer.kind === 'escape') {
    return {kind: 'cancelled'};
  }
  return {
    kind: 'chosen',
    features: listed
      .filter(feature => answer.checked.has(featureKeyOf(feature)))
      .map(feature => ({id: featureKeyOf(feature), options: {}})),
    mode: answer.kind === 'finish' ? 'defaults' : 'configure',
  };
}
