/**
 * @fileoverview The template pick of the wizard that adds a dev container configuration, over a quick pick the caller's
 * port makes: the chooser that offers an existing Dockerfile first, then the list of templates, flat or curated, with
 * a custom template id in place of a listed one. The pick touches no file: what the caller read of the folder is given.
 */

import type {TemplateMetadataResult} from '../cli/cli-lines.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import {failureText} from '../surfaces/failure-strings.ts';
import {CONTAINERS_INTRODUCTION} from '../surfaces/recovery-presenter.ts';
import type {CatalogueTemplate} from './catalogue.ts';
import {type QuickPicker, shownPick} from './quick-pick.ts';
import {
  curatedTemplates,
  type FolderFacts,
  isCurated,
} from './curated-templates.ts';

/** The English template of each text of the pick, by its string id. */
const PICK_TEMPLATES = {
  S024: 'Add Dev Container Configuration Files',
  S040: 'Apply this custom template instead of one of the listed templates.',
  S148: 'Documentation on predefined container templates',
  S189: "From '{0}'",
  S190: 'From a predefined container configuration template...',
  S198: 'How would you like to create your container configuration?',
  S287: "Refer to the existing '{0}' in the container configuration",
  S302: 'Select a container configuration template or enter a custom template id',
  S323: 'Show All Templates...',
  S325: 'Show all available predefined container templates.',
  S388: "Use '{0}' as template...",
  S390: 'Use a base configuration from the container template registry',
} as const;

/** The template an entry of the chooser stands for, by the last part of its id. */
const EXISTING_DOCKERFILE = 'docker-existing-dockerfile';

/** The number of slashes in a value from which it is a custom template id. */
const CUSTOM_SLASHES = 2;

/** What the pick ends with. */
export type TemplateChoice =
  | {kind: 'listed'; template: CatalogueTemplate}
  | {
      kind: 'custom';
      templateId: string;
      metadata?: Readonly<Record<string, unknown>>;
    }
  | {kind: 'reuse'; template: CatalogueTemplate; entry: string}
  | {kind: 'learnMore'}
  | {kind: 'cancelled'}
  | {kind: 'failed'; cause: string};

/** What a row of the pick does when it is accepted. */
type RowAction =
  | {kind: 'template'; template: CatalogueTemplate}
  | {kind: 'custom'; value: string}
  | {kind: 'reuse'; entry: string}
  | {kind: 'chooseTemplate'}
  | {kind: 'showAll'}
  | {kind: 'learnMore'};

/** One row of the pick, with what it does. */
export interface PickRow {
  label: string;
  description?: string;
  detail?: string;
  alwaysShow?: boolean;
  /** The editor's icon of the verified owner. */
  iconPath?: unknown;
  action: RowAction;
}

/** The members of the editor's quick pick the pick uses. */
export type TemplatePicker = QuickPicker<PickRow>;

/** What the pick needs of its surroundings. */
export interface TemplatePickPorts {
  createQuickPick(): TemplatePicker;
  /** The editor's icon that marks a verified owner. */
  verifiedIcon: unknown;
  /** Opens a page outside the editor. */
  openExternal(address: string): unknown;
  /** The metadata of the template `templateId` names, as the CLI gives it. */
  templateMetadata(
    templateId: string,
    cancellation: AbortSignal,
  ): Promise<TemplateMetadataResult>;
  /**
   * The start of the ids of the templates our curated table may show: the catalogue's own collection's. Nothing when
   * the catalogue has none, which leaves the flat list whatever the folder holds.
   */
  curatedPrefix: string | undefined;
  /** Whether a template carries the verified mark. */
  isVerified(template: CatalogueTemplate): boolean;
  translate: Translate;
}

/** What the caller asks for. */
export interface TemplatePickRequest {
  /** The title of the quick input, S024 for the command that adds the configuration. */
  title: string;
  folder: FolderFacts;
  catalogue: readonly CatalogueTemplate[];
}

function text(
  ports: TemplatePickPorts,
  name: keyof typeof PICK_TEMPLATES,
  values: readonly string[] = [],
): string {
  return filled(ports.translate, PICK_TEMPLATES[name], values);
}

function learnMoreRow(ports: TemplatePickPorts): PickRow {
  return {
    label: failureText('S218', [], ports.translate),
    description: text(ports, 'S148'),
    alwaysShow: true,
    action: {kind: 'learnMore'},
  };
}

/** The Dockerfile-family entries of the folder's root, by character code: a file or a folder named so in any case. */
function dockerfileEntries(folder: FolderFacts): string[] {
  return folder.rootEntries
    .filter(
      entry =>
        entry.kind !== 'other' &&
        entry.name.toLowerCase().includes('dockerfile'),
    )
    .map(entry => entry.name)
    .sort((left, right) => (left < right ? -1 : 1));
}

/** The last part of a template's id. */
function lastPartOf(template: CatalogueTemplate): string {
  return template.id.slice(template.id.lastIndexOf('/') + 1);
}

/** The rows of the chooser that offers an existing Dockerfile, with the template pick first. */
function chooserRows(
  entries: readonly string[],
  ports: TemplatePickPorts,
): PickRow[] {
  return [
    {
      label: text(ports, 'S190'),
      detail: text(ports, 'S390'),
      action: {kind: 'chooseTemplate'},
    },
    ...entries.map((entry): PickRow => ({
      label: text(ports, 'S189', [entry]),
      detail: text(ports, 'S287', [entry]),
      action: {kind: 'reuse', entry},
    })),
    learnMoreRow(ports),
  ];
}

/** A template as a row. */
function templateRow(
  template: CatalogueTemplate,
  ports: TemplatePickPorts,
): PickRow {
  return {
    label: template.name,
    description: template.owner,
    ...(ports.isVerified(template) ? {iconPath: ports.verifiedIcon} : {}),
    action: {kind: 'template', template},
  };
}

/** The templates by name, ties in the order they came in. */
function byName(templates: readonly CatalogueTemplate[]): CatalogueTemplate[] {
  return [...templates].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/** The template pick: the list of templates, flat or curated, with custom ids. */
function templatePick(
  request: TemplatePickRequest,
  ports: TemplatePickPorts,
  cancellation: AbortSignal,
): Promise<TemplateChoice> {
  const prefix = ports.curatedPrefix;
  const curatedList =
    prefix !== undefined && isCurated(request.folder)
      ? byName(curatedTemplates(request.catalogue, request.folder, prefix))
      : undefined;
  const flat = byName(request.catalogue);
  let showingAll = false;
  return shownPick<PickRow, TemplateChoice>(
    () => ports.createQuickPick(),
    cancellation,
    (picker, finish) => {
      /** The curated templates while the curated list shows; none once Show All Templates was taken. */
      function curated(): CatalogueTemplate[] | undefined {
        return showingAll ? undefined : curatedList;
      }
      function showAllRow(): PickRow {
        return {
          label: text(ports, 'S323'),
          detail: text(ports, 'S325'),
          alwaysShow: true,
          action: {kind: 'showAll'},
        };
      }
      function rowsFor(value: string): PickRow[] {
        const list = curated();
        const templates = list ?? flat;
        const extra = list === undefined ? [] : [showAllRow()];
        if (value.split('/').length - 1 >= CUSTOM_SLASHES) {
          return [
            {
              label: text(ports, 'S388', [value]),
              detail: text(ports, 'S040'),
              alwaysShow: true,
              action: {kind: 'custom', value},
            },
            learnMoreRow(ports),
            ...extra,
          ];
        }
        return [
          ...extra,
          learnMoreRow(ports),
          ...templates.map(each => templateRow(each, ports)),
        ];
      }
      function show(value: string): void {
        const rows = rowsFor(value);
        picker.items = rows;
        const first = rows.find(
          each =>
            each.action.kind === 'template' || each.action.kind === 'custom',
        );
        picker.activeItems = first === undefined ? [] : [first];
      }
      picker.title = request.title;
      picker.placeholder = text(ports, 'S302');
      show('');
      picker.onDidChangeValue(show);
      picker.onDidAccept(() => {
        const [selected] = picker.selectedItems;
        const action = selected?.action;
        if (action === undefined) {
          return;
        }
        if (action.kind === 'showAll') {
          showingAll = true;
          show(picker.value);
        } else if (action.kind === 'learnMore') {
          void ports.openExternal(CONTAINERS_INTRODUCTION);
          finish({kind: 'learnMore'});
        } else if (action.kind === 'template') {
          finish({kind: 'listed', template: action.template});
        } else if (action.kind === 'custom') {
          void ports
            .templateMetadata(action.value, cancellation)
            .then(result => {
              finish({
                kind: 'custom',
                templateId: action.value,
                ...(result.kind === 'metadata'
                  ? {metadata: result.metadata}
                  : {}),
              });
            });
        }
      });
    },
  );
}

/** The chooser that offers an existing Dockerfile, which goes on to the template pick when asked. */
async function chooserPick(
  entries: readonly string[],
  request: TemplatePickRequest,
  ports: TemplatePickPorts,
  cancellation: AbortSignal,
): Promise<TemplateChoice> {
  let chosen: RowAction | undefined;
  const outcome = await shownPick<PickRow, TemplateChoice>(
    () => ports.createQuickPick(),
    cancellation,
    (picker, finish) => {
      const rows = chooserRows(entries, ports);
      picker.title = request.title;
      picker.placeholder = text(ports, 'S198');
      picker.items = rows;
      picker.activeItems = rows.slice(0, 1);
      picker.onDidAccept(() => {
        const [selected] = picker.selectedItems;
        chosen = selected?.action;
        if (chosen?.kind === 'chooseTemplate') {
          finish({kind: 'cancelled'});
        } else if (chosen?.kind === 'learnMore') {
          void ports.openExternal(CONTAINERS_INTRODUCTION);
          finish({kind: 'learnMore'});
        } else if (chosen?.kind === 'reuse') {
          const existing = request.catalogue.find(
            template => lastPartOf(template) === EXISTING_DOCKERFILE,
          );
          const {entry} = chosen;
          finish(
            existing === undefined
              ? {
                  kind: 'failed',
                  cause: `the catalogue has no ${EXISTING_DOCKERFILE} template`,
                }
              : {kind: 'reuse', template: existing, entry},
          );
        }
      });
    },
  );
  return chosen?.kind === 'chooseTemplate'
    ? templatePick(request, ports, cancellation)
    : outcome;
}

/**
 * Asks which template the configuration starts from. A folder whose root holds a Dockerfile-family entry is asked
 * first whether to refer to it; the list of templates is flat, or curated when the folder holds a significant file.
 */
export function pickTemplate(
  request: TemplatePickRequest,
  ports: TemplatePickPorts,
  cancellation: AbortSignal,
): Promise<TemplateChoice> {
  const entries = dockerfileEntries(request.folder);
  return entries.length === 0
    ? templatePick(request, ports, cancellation)
    : chooserPick(entries, request, ports, cancellation);
}
