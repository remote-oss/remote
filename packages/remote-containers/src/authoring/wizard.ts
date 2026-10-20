/**
 * @fileoverview The wizard that adds a dev container configuration to a folder (C14): the catalogue is fetched, the
 * stages ask what the configuration starts from, and the template is written. It never reloads, never opens an editor
 * and never starts a container: each caller goes on from its outcome.
 */

import path from 'node:path';
import {applyEdits, modify} from 'jsonc-parser';
import {fetchCatalogue, showCatalogueFailure} from './catalogue.ts';
import {readFolderFacts} from './folder-facts.ts';
import {
  type StageMemory,
  stagesOf,
  type WizardOutcome,
  type WizardPorts,
  type WizardStage,
  type WizardState,
  NO_TEMPLATE,
  type WizardTarget,
} from './wizard-stages.ts';
import type {WriteOutcome} from './write.ts';
import {
  parseConfiguration,
  decodeConfiguration,
} from '../config/configuration-text.ts';

/** The file the template writes the configuration into, relative to the folder. */
const CONFIGURATION_FILE = '.devcontainer/devcontainer.json';

/** What a walk through the stages gives: the state they built, or the end one of them chose. */
type Walked =
  {kind: 'state'; state: WizardState} | {kind: 'ended'; outcome: WizardOutcome};

/** The record of a stage that showed something: the state it was entered with and the one it gave. */
interface Visit {
  index: number;
  entered: WizardState;
}

/**
 * Walks the stages from `initial`. A stage that returns Back sends the walk to the last stage that showed something,
 * which gets the state it was entered with, and its last answer when `keep` says so; Back from the first stage that
 * showed something runs that stage again.
 */
export async function walkStages(
  stages: readonly WizardStage[],
  initial: WizardState,
  cancellation: AbortSignal,
): Promise<Walked> {
  const memory = new Map<number, StageMemory>();
  const visits: Visit[] = [];
  let index = 0;
  let state = initial;
  let previous: StageMemory | undefined = undefined;
  for (let stage = stages[index]; stage !== undefined; stage = stages[index]) {
    const entered = state;
    const result = await stage.execute(state, previous, cancellation);
    previous = undefined;
    if (result.kind === 'next') {
      memory.set(index, {state: result.state});
      if (result.shown) {
        visits.push({index, entered});
      }
      state = result.state;
      index += 1;
    } else if (result.kind === 'back') {
      const last = visits.pop();
      index = last?.index ?? index;
      state = last?.entered ?? state;
      previous = result.keep ? memory.get(index) : undefined;
    } else if (result.kind === 'cancelled') {
      return {kind: 'ended', outcome: {kind: 'cancelled'}};
    } else {
      return {kind: 'ended', outcome: result.outcome};
    }
  }
  return {kind: 'state', state};
}

/** The folder the configuration is written into. */
function targetFolderOf(state: WizardState, ports: WizardPorts): string {
  return state.target.kind === 'workspace'
    ? state.folder
    : ports.slotFolder(state.target.slot);
}

/**
 * Makes the written configuration refer to the Dockerfile-family entry the user picked: the template's own default
 * may name another file, so the entry is written into `build.dockerfile` after the copy, relative to the folder of the
 * configuration.
 */
async function referToEntry(
  folder: string,
  entry: string,
  ports: WizardPorts,
): Promise<void> {
  const file = path.join(folder, CONFIGURATION_FILE);
  const wanted = `../${entry}`;
  const text = decodeConfiguration(await ports.files.read(file));
  const parsed = parseConfiguration(text);
  const build = parsed?.build;
  const named =
    typeof build === 'object' && build !== null
      ? (build as Record<string, unknown>).dockerfile
      : undefined;
  if (named !== wanted) {
    const base = parsed === undefined ? '{}' : text;
    const edited = applyEdits(
      base,
      modify(base, ['build', 'dockerfile'], wanted, {
        formattingOptions: {insertSpaces: true, tabSize: 4},
      }),
    );
    await ports.files.write(file, new TextEncoder().encode(edited));
    ports.record(`the configuration now refers to ${entry}`);
  }
}

/** The outcome of the wizard from the write's. */
function outcomeOf(written: WriteOutcome, folder: string): WizardOutcome {
  if (written.kind === 'written') {
    return {kind: 'written', files: written.files, target: folder};
  }
  return written.kind === 'cancelled'
    ? {kind: 'cancelled'}
    : {kind: 'failed', detail: written.detail};
}

/**
 * Runs the wizard for `request.folder`: the catalogue is fetched (a failure is shown and ends it), the stages run, and
 * the template is written with what they chose.
 */
export async function runWizard(
  request: {title: string; folder: string; target?: WizardTarget},
  ports: WizardPorts,
  cancellation: AbortSignal,
): Promise<WizardOutcome> {
  const catalogue = await fetchCatalogue(ports.catalogue, cancellation);
  if (catalogue.kind === 'failed') {
    await showCatalogueFailure(ports.dialogs, ports.translate, catalogue.cause);
    return {kind: 'failed', detail: catalogue.cause};
  }
  const facts = await readFolderFacts(ports.files, request.folder);
  const walked = await walkStages(
    stagesOf(catalogue, {...ports, title: request.title, facts}),
    {
      folder: request.folder,
      target: request.target ?? {kind: 'workspace'},
      template: NO_TEMPLATE,
      templateArgs: {},
      features: [],
      featureMode: 'defaults',
      omitPaths: [],
    },
    cancellation,
  );
  if (walked.kind === 'ended') {
    return walked.outcome;
  }
  const {state} = walked;
  const folder = targetFolderOf(state, ports);
  const written = await ports.write(
    {
      targetFolder: folder,
      templateId: state.template.id,
      templateArgs: state.templateArgs,
      features: state.features,
      omitPaths: state.omitPaths,
    },
    cancellation,
  );
  if (written.kind === 'written' && state.reuseEntry !== undefined) {
    await referToEntry(folder, state.reuseEntry, ports);
  }
  return outcomeOf(written, folder);
}
