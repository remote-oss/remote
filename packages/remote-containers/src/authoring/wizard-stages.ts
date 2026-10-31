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
  type CatalogueTemplate,
  showCatalogueFailure,
} from './catalogue.ts';
import {
  curatedPrefixOf,
  type FolderFacts,
  isSpecificationTemplate,
} from './curated-templates.ts';
import type {WalkFiles} from './folder-facts.ts';
import {askLocation, type LocationPorts} from './location.ts';
import {pickTemplate, type TemplatePickPorts} from './template-pick.ts';
import type {WriteOutcome, WriteRequest} from './write.ts';

/** Where the configuration is written: the workspace folder, or a slot of the extension's own store. */
export type WizardTarget =
  {kind: 'workspace'} | {kind: 'userData'; slot: string};

/** A Feature the user chose, with its options. */
interface FeatureChoice {
  /** The id with its major version, as the CLI writes the key. */
  id: string;
  options: Record<string, string | boolean>;
}

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
  | {kind: 'failed'; detail: string};

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
    name: templateId,
    owner: '',
    options: recordOf(metadata?.options),
    optionalPaths: paths,
  };
}

/** The template of a state before one is chosen. */
export const NO_TEMPLATE: CatalogueTemplate = customTemplateOf('', undefined);

/** The defaults of a template's options, each as the CLI's `-a` takes it. */
function defaultsOf(template: CatalogueTemplate): Record<string, string> {
  return Object.fromEntries(
    Object.entries(template.options).flatMap(([name, option]) => {
      const fallback = recordOf(option).default;
      return typeof fallback === 'string' ||
        typeof fallback === 'number' ||
        typeof fallback === 'boolean'
        ? [[name, String(fallback)]]
        : [];
    }),
  );
}

/** The state after the template is chosen: its defaults, and every optional path left out. */
function withTemplate(
  state: WizardState,
  template: CatalogueTemplate,
  reuseEntry?: string,
): WizardState {
  return {
    ...state,
    template,
    templateArgs: defaultsOf(template),
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
      const choice = await pickTemplate(
        {title: ports.title, folder: ports.facts, catalogue},
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

/** The stages of the wizard, in order, made once the catalogue is read. */
export function stagesOf(
  catalogue: CatalogueResult & {kind: 'catalogue'},
  ports: StagePorts,
): readonly WizardStage[] {
  const templatePick = templatePickStage(catalogue.templates, ports);
  return ports.location === undefined
    ? [templatePick]
    : [locationStage(ports.location, ports), templatePick];
}
