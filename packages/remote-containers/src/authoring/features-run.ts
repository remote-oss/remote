/**
 * @fileoverview The pick of the Features for a configuration file and the write of it: the screen opens with the
 * Features the file already lists checked, and what the user accepts is written into `"features"` with
 * `editFeatures`, to disk, whatever an open editor holds. The picks name Features by their catalogue key, never by the
 * key the file happens to use for them, and the checked ones are in the catalogue's order.
 */

import type {Logger} from 'lib-log';
import {parseConfiguration} from '../config/configuration-text.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  type CatalogueFeature,
  type CataloguePorts,
  fetchCatalogue,
} from './catalogue.ts';
import type {
  ChosenConfiguration,
  FeaturesOutcome,
  WindowFolder,
} from './configure-features.ts';
import {catalogueKeyOf, editFeatures} from './edit-features.ts';
import type {QuickInputPorts} from './option-screens.ts';
import {askFeatureOptions} from './feature-options.ts';
import {askFeatures, featureKeyOf} from './select-features.ts';

/** The English templates of the texts of the run, by their string ids. */
const RUN_TEMPLATES = {
  commandFailed:
    "Command 'Dev Containers: Configure Container Features...' resulted in an error",
} as const;

/** What the run needs of its surroundings. */
export interface FeaturesRunPorts {
  catalogue: CataloguePorts;
  quick: QuickInputPorts;
  /** Shows a modal error with the detail. */
  showError(message: string, detail: string): PromiseLike<unknown>;
  /** Opens the file in a preview editor tab with the cursor at the first line and column. */
  openPreview(
    file: string,
    root: WindowFolder | undefined,
  ): PromiseLike<unknown>;
  translate: Translate;
  logger: Logger;
}

/** The catalogue keys of the Features that the entries of `"features"` in `text` refer to. */
function listedKeys(
  text: string,
  catalogue: readonly CatalogueFeature[],
): string[] {
  const features = parseConfiguration(text)?.features;
  const entries =
    typeof features === 'object' &&
    features !== null &&
    !Array.isArray(features)
      ? Object.keys(features)
      : [];
  return [
    ...new Set(
      entries.flatMap(entry => catalogueKeyOf(entry, catalogue) ?? []),
    ),
  ];
}

/** The run over `ports`: for a configuration chosen, the pick, the write and the editor that shows the file. */
export function featuresRunOf(
  ports: FeaturesRunPorts,
): (configuration: ChosenConfiguration) => Promise<FeaturesOutcome> {
  const {translate, logger} = ports;
  return async configuration => {
    const cancellation = new AbortController().signal;
    const catalogue = await fetchCatalogue(ports.catalogue, cancellation);
    if (catalogue.kind === 'failed') {
      await ports.showError(
        translate(RUN_TEMPLATES.commandFailed),
        catalogue.cause,
      );
      return {kind: 'failed', detail: catalogue.cause};
    }
    const present = listedKeys(configuration.text, catalogue.features);
    const answer = await askFeatures(
      catalogue.features,
      present.map(key => ({id: key, options: {}})),
      {quick: ports.quick, withoutBack: true},
      cancellation,
    );
    if (answer.kind !== 'chosen') {
      return {kind: 'cancelled'};
    }
    const chosen = new Set(answer.features.map(each => each.id));
    // The checked Features in the catalogue's order, which is the order of the walk and of the keys written.
    const ordered = catalogue.features.filter(feature =>
      chosen.has(featureKeyOf(feature)),
    );
    const walk =
      answer.mode === 'configure'
        ? await askFeatureOptions(
            ordered.map(feature => ({
              choice: {id: featureKeyOf(feature), options: {}},
              feature,
            })),
            true,
            ports.quick,
            cancellation,
            true,
          )
        : undefined;
    if (walk !== undefined && walk.kind !== 'chosen') {
      return {kind: 'cancelled'};
    }
    const options = new Map(
      (walk?.features ?? []).map(each => [each.id, each.options]),
    );
    const edit = editFeatures(configuration.text, {
      checked: ordered.map(feature => ({
        key: featureKeyOf(feature),
        value: options.get(featureKeyOf(feature)) ?? {},
      })),
      unchecked: present.filter(key => !chosen.has(key)),
    });
    if (edit.kind === 'notAnObject') {
      logger.warn(
        `"features" of ${configuration.relative} is not an object: nothing is written`,
      );
      return {kind: 'failed', detail: 'features is not an object'};
    }
    if (edit.kind === 'unchanged') {
      await ports.openPreview(configuration.file, configuration.root);
      return {kind: 'unchanged'};
    }
    try {
      await configuration.files.write(
        configuration.file,
        new TextEncoder().encode(edit.text),
      );
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      logger.warn(`${configuration.relative} was not written: ${detail}`);
      await ports.showError('', detail);
      return {kind: 'failed', detail};
    }
    await ports.openPreview(configuration.file, configuration.root);
    return {kind: 'written', file: configuration.file};
  };
}
