/**
 * @fileoverview The stages of the wizard that adds a dev container configuration: the state they build up, what a
 * stage answers, and the list of stages in one place. Later stages (the location, the template's options, the
 * Features, the optional paths) change only that list and the initial state's defaults.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  type CatalogueDialogs,
  type CataloguePorts,
  type CatalogueResult,
  type CatalogueFeature,
  type CatalogueTemplate,
  showCatalogueFailure,
} from './catalogue.ts';
import {
  curatedPrefixOf,
  type FolderFacts,
  isSpecificationTemplate,
} from './curated-templates.ts';
import type {WalkFiles} from './folder-facts.ts';
import {copyStored, type CopyStoredPorts} from './copy-stored.ts';
import {askLocation, type LocationPorts} from './location.ts';
import type {QuickInputPorts} from './option-screens.ts';
import {pickTemplate, type TemplatePickPorts} from './template-pick.ts';
import {askFeatureOptions} from './feature-options.ts';
import {
  askFeatures,
  type FeatureChoice,
  featureKeyOf,
} from './select-features.ts';
import {askTemplateOptions} from './template-options.ts';
import {slotOf} from './user-data-store.ts';
import type {WriteOutcome, WriteRequest} from './write.ts';

/** Where the configuration is written: the workspace folder, or a slot of the extension's own store. */
export type WizardTarget =
  {kind: 'workspace'} | {kind: 'userData'; slot: string};

/** What the stages have decided so far. */
export interface WizardState {
  readonly folder: string;
  readonly target: WizardTarget;
  /** The template; `NO_TEMPLATE` until the template pick ran. */
  readonly template: CatalogueTemplate;
  /** The template's options, each as the CLI's `-a` takes it. */
  readonly templateArgs: Readonly<Record<string, string>>;
  readonly features: readonly FeatureChoice[];
  /** How Select Features was confirmed: Finish, or OK. */
  readonly featureMode: 'defaults' | 'configure';
  readonly omitPaths: readonly string[];
  /** The Dockerfile-family entry the user asked to refer to, which the written configuration must name. */
  readonly reuseEntry?: string;
}

/** How the wizard ends. */
export type WizardOutcome =
  | {
      kind: 'written';
      files: string[];
      /** The folder the files are in. */
      target: string;
      /** Whether that is the workspace or a slot of the store. */
      place: WizardTarget['kind'];
    }
  | {kind: 'cancelled'}
  | {kind: 'failed'; detail: string}
  /** The user asked to see the stored configuration instead: the command shows this file and writes nothing. */
  | {kind: 'openStored'; file: string};

/** What a stage answers. */
export type StageResult =
  /** `shown` false: the stage showed nothing and Back passes over it. */
  | {kind: 'next'; state: WizardState; shown: boolean}
  /** `keep`: the previous shown stage runs again with its last answer. */
  | {kind: 'back'; keep: boolean}
  | {kind: 'cancelled'}
  /** A stage that ends the wizard itself. */
  | {kind: 'done'; outcome: WizardOutcome};

/** The state a stage returned the last time it ran. */
export interface StageMemory {
  readonly state: WizardState;
}

/** One stage of the wizard. */
export interface WizardStage {
  readonly name: string;
  execute(
    state: WizardState,
    previous: StageMemory | undefined,
    cancellation: AbortSignal,
  ): Promise<StageResult>;
}

/** The files the wizard reads and writes besides the template: the folder's entries and the written configuration. */
interface WizardFiles extends WalkFiles {
  read(file: string): Promise<Uint8Array>;
  /** Writes the bytes, replacing the file. */
  write(file: string, bytes: Uint8Array): Promise<void>;
}

/** What the wizard needs of its surroundings. */
export interface WizardPorts {
  catalogue: CataloguePorts;
  dialogs: CatalogueDialogs;
  /** The quick pick and its surroundings; the wizard adds the curated prefix and the verified test. */
  pick: Omit<TemplatePickPorts, 'curatedPrefix' | 'isVerified'>;
  /** The quick input of the option screens; the wizard adds the translation. */
  options: Omit<QuickInputPorts, 'translate'>;
  /** Writes the template with what the stages chose. */
  write(
    request: WriteRequest,
    cancellation: AbortSignal,
  ): Promise<WriteOutcome>;
  files: WizardFiles;
  /** The folder of a slot of the extension's own store. */
  slotFolder(slot: string): string;
  /** The location pick and the store behind it; without it the configuration goes to the workspace. */
  location?: LocationPorts;
  /** The copy of a stored configuration into the workspace. */
  stored: CopyStoredPorts;
  /** Writes a line to the Dev Containers log. */
  record(line: string): void;
  translate: Translate;
}

/** What the stages are made with: the ports, the title of the quick input, and what was read of the folder. */
export interface StagePorts extends WizardPorts {
  title: string;
  facts: FolderFacts;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The template a custom id stands for, from the metadata the CLI gave it (none when it gave none). */
function customTemplateOf(
  templateId: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
): CatalogueTemplate {
  const paths = Array.isArray(metadata?.optionalPaths)
    ? (metadata.optionalPaths as unknown[]).filter(
        (path): path is string => typeof path === 'string',
      )
    : [];
  return {
    id: templateId,
    version: '',
    name:
      typeof metadata?.name === 'string' && metadata.name !== ''
        ? metadata.name
        : templateId,
    owner: '',
    options: recordOf(metadata?.options),
    optionalPaths: paths,
  };
}

/** The template of a state before one is chosen. */
export const NO_TEMPLATE: CatalogueTemplate = customTemplateOf('', undefined);

/** The state after the template is chosen: no option value yet, and every optional path left out. */
function withTemplate(
  state: WizardState,
  template: CatalogueTemplate,
  reuseEntry?: string,
): WizardState {
  return {
    ...state,
    template,
    templateArgs: {},
    omitPaths: template.optionalPaths,
    ...(reuseEntry === undefined ? {} : {reuseEntry}),
  };
}

/** The stage that asks which template the configuration starts from. */
function templatePickStage(
  catalogue: readonly CatalogueTemplate[],
  ports: StagePorts,
): WizardStage {
  const prefix = curatedPrefixOf(catalogue, line => {
    ports.record(line);
  });
  return {
    name: 'templatePick',
    execute: async (state, previous, cancellation) => {
      const location = ports.location;
      const storedSlot =
        location === undefined || state.target.kind !== 'workspace'
          ? undefined
          : await slotOf(location.storeRoot, state.folder, location.store);
      const choice = await pickTemplate(
        {title: ports.title, folder: ports.facts, catalogue, storedSlot},
        {
          ...ports.pick,
          curatedPrefix: prefix,
          isVerified: isSpecificationTemplate,
        },
        cancellation,
      );
      switch (choice.kind) {
        case 'listed':
          return {
            kind: 'next',
            state: withTemplate(state, choice.template),
            shown: true,
          };
        case 'custom':
          return {
            kind: 'next',
            state: withTemplate(
              state,
              customTemplateOf(choice.templateId, choice.metadata),
            ),
            shown: true,
          };
        case 'reuse':
          return {
            kind: 'next',
            state: withTemplate(state, choice.template, choice.entry),
            shown: true,
          };
        case 'copyStored':
          return {
            kind: 'done',
            outcome: await copyStored(
              {folder: state.folder, slot: choice.slot},
              ports.stored,
            ),
          };
        case 'openStored':
          return {
            kind: 'done',
            outcome: {kind: 'openStored', file: choice.slot.configFile},
          };
        case 'learnMore':
        case 'cancelled':
          return {kind: 'done', outcome: {kind: 'cancelled'}};
        default:
          await showCatalogueFailure(
            ports.dialogs,
            ports.translate,
            choice.cause,
          );
          return {
            kind: 'done',
            outcome: {kind: 'failed', detail: choice.cause},
          };
      }
    },
  };
}

/** The stage that asks where the configuration goes. */
function locationStage(
  location: LocationPorts,
  ports: StagePorts,
): WizardStage {
  return {
    name: 'location',
    execute: async (state, previous, cancellation) => {
      const choice = await askLocation(
        location,
        {
          title: ports.title,
          folder: state.folder,
          facts: ports.facts,
          files: ports.files,
          translate: ports.translate,
        },
        cancellation,
      );
      if (choice.kind === 'cancelled') {
        return {kind: 'done', outcome: {kind: 'cancelled'}};
      }
      const target: WizardTarget =
        choice.kind === 'workspace'
          ? choice
          : {kind: 'userData', slot: choice.slot};
      return {kind: 'next', state: {...state, target}, shown: true};
    },
  };
}

/** The stage that asks for the template's options. */
function templateOptionsStage(ports: StagePorts): WizardStage {
  return {
    name: 'templateOptions',
    execute: async (state, previous, cancellation) => {
      const answer = await askTemplateOptions(
        state.template,
        {
          title: ports.title,
          quick: {...ports.options, translate: ports.translate},
        },
        cancellation,
      );
      switch (answer.kind) {
        case 'chosen':
          return {
            kind: 'next',
            state: {...state, templateArgs: answer.templateArgs},
            shown: answer.shown,
          };
        case 'back':
          return {kind: 'back', keep: false};
        default:
          return {kind: 'cancelled'};
      }
    },
  };
}

/** The stage that asks which Features to install. */
function selectFeaturesStage(
  features: readonly CatalogueFeature[],
  ports: StagePorts,
): WizardStage {
  return {
    name: 'selectFeatures',
    execute: async (state, previous, cancellation) => {
      const answer = await askFeatures(
        features,
        previous?.state.features ?? [],
        {quick: {...ports.options, translate: ports.translate}},
        cancellation,
      );
      switch (answer.kind) {
        case 'chosen':
          return {
            kind: 'next',
            state: {
              ...state,
              features: answer.features,
              featureMode: answer.mode,
            },
            shown: true,
          };
        case 'back':
          return {kind: 'back', keep: false};
        default:
          return {kind: 'cancelled'};
      }
    },
  };
}

/** The stage that asks for the options of the Features chosen. */
function featureOptionsStage(
  features: readonly CatalogueFeature[],
  ports: StagePorts,
): WizardStage {
  return {
    name: 'featureOptions',
    execute: async (state, previous, cancellation) => {
      const chosen = state.features.map(choice => ({
        choice,
        feature: features.find(each => featureKeyOf(each) === choice.id) ?? {
          id: choice.id,
          version: '',
          name: choice.id,
          options: {},
        },
      }));
      const answer = await askFeatureOptions(
        chosen,
        state.featureMode === 'configure',
        {...ports.options, translate: ports.translate},
        cancellation,
      );
      switch (answer.kind) {
        case 'chosen':
          return {
            kind: 'next',
            state: {...state, features: answer.features},
            shown: answer.shown,
          };
        case 'back':
          return {kind: 'back', keep: false};
        default:
          return {kind: 'cancelled'};
      }
    },
  };
}

/** The stages of the wizard, in order, made once the catalogue is read. */
export function stagesOf(
  catalogue: CatalogueResult & {kind: 'catalogue'},
  ports: StagePorts,
): readonly WizardStage[] {
  const rest = [
    templatePickStage(catalogue.templates, ports),
    templateOptionsStage(ports),
    selectFeaturesStage(catalogue.features, ports),
    featureOptionsStage(catalogue.features, ports),
  ];
  return ports.location === undefined
    ? rest
    : [locationStage(ports.location, ports), ...rest];
}
