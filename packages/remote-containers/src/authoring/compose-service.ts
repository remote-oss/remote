/**
 * @fileoverview The wizard's service step for an existing Compose file: the services the file declares,
 * read in declaration order, and the pick among two or more. One service is used without a step, and none gives the
 * empty name.
 */

import {isMap, isScalar, isSeq, parseDocument} from 'yaml';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import {type OptionRow, type QuickInputPorts, shown} from './option-screens.ts';

/** The English template of the step's placeholder. */
const SERVICE_TEMPLATES = {
  S306: 'Select a service',
} as const;

/**
 * The names of the services `text` declares, in declaration order: a mapping's keys, a list's indices, and none for an
 * empty or absent `services:` or a document that isn't a mapping. Throws on a YAML error, and on more aliases than the
 * parser's default allows, so a hostile file fails before anything is expanded.
 */
export function composeServicesOf(text: string): string[] {
  const document = parseDocument(text);
  const [error] = document.errors;
  if (error !== undefined) {
    throw new Error(error.message);
  }
  document.toJS();
  const root = document.contents;
  const services = isMap(root) ? root.get('services', true) : undefined;
  if (isMap(services)) {
    return services.items.map(pair =>
      isScalar(pair.key) ? String(pair.key.value) : String(pair.key),
    );
  }
  return isSeq(services)
    ? services.items.map((item, index) => String(index))
    : [];
}

/** How the step ends. */
export type ServiceAnswer =
  | {kind: 'chosen'; service: string; shown: boolean}
  | {kind: 'back'}
  | {kind: 'cancelled'};

/** Asks which service the configuration uses, when the file declares two or more; otherwise answers without a step. */
export function askService(
  services: readonly string[],
  screen: {title: string; quick: QuickInputPorts},
  cancellation: AbortSignal,
): Promise<ServiceAnswer> {
  if (services.length < 2) {
    return Promise.resolve({
      kind: 'chosen',
      service: services[0] ?? '',
      shown: false,
    });
  }
  return shown<ServiceAnswer>(
    screen.quick,
    cancellation,
    {escape: {kind: 'cancelled'}, back: {kind: 'back'}},
    (picker, finish) => {
      const rows = services.map((service): OptionRow => ({
        label: service,
        value: service,
      }));
      picker.title = screen.title;
      picker.placeholder = placeholderOf(screen.quick.translate);
      picker.canSelectMany = false;
      picker.items = rows;
      picker.activeItems = rows.slice(0, 1);
      picker.onDidAccept(() => {
        const [selected] = picker.selectedItems;
        if (selected !== undefined) {
          finish({kind: 'chosen', service: selected.value, shown: true});
        }
      });
    },
  );
}

function placeholderOf(translate: Translate): string {
  return filled(translate, SERVICE_TEMPLATES.S306);
}

/** A service name YAML reads as itself without quotes. */
const PLAIN_KEY = /^[A-Za-z0-9_.-]+$/;

/** The top-level `services:` line. */
const SERVICES_LINE = /^services:\s*(?:#.*)?$/;

/** An indented key with nothing after its colon but a comment: the first service's key line. */
const SERVICE_KEY_LINE = /^(\s+)[^\s#][^:]*(:\s*(?:#.*)?)$/;

/**
 * `text`, a generated compose file, with its first service's key replaced by `service`: written bare when YAML reads it
 * as itself, quoted otherwise, and left empty for `''`, the nameless placeholder that makes an unedited configuration
 * fail when it is used. The lines around it, its comments included, stay as they are; a file with no service under
 * `services:` is returned unchanged.
 */
export function withServiceKey(text: string, service: string): string {
  const key =
    service === '' || PLAIN_KEY.test(service)
      ? service
      : JSON.stringify(service);
  const lines = text.split('\n');
  const start = lines.findIndex(line => SERVICES_LINE.test(line));
  let replaced = start < 0;
  return lines
    .map((line, index) => {
      if (replaced || index <= start || !SERVICE_KEY_LINE.test(line)) {
        return line;
      }
      replaced = true;
      return line.replace(
        SERVICE_KEY_LINE,
        `$1${key.replaceAll('$', '$$$$')}$2`,
      );
    })
    .join('\n');
}
