/**
 * @fileoverview Inspect, for a container row of the Dev Containers view and for the Image row of the Details view: it
 * runs Docker's inspect on the view's own engine and opens the first object of the reply as an untitled JSON document,
 * indented with tabs. Every call opens a new document, and a call without such a row does nothing at all.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import {recordOf} from './listed-containers.ts';
import {containerRowOf} from './row-actions.ts';

/** The English template of the text of a failed inspect; it has no string id of its own. */
const FAILED_TEMPLATE = 'Error inspecting: {0}';

/** What Inspect needs of its surroundings. */
export interface InspectPorts {
  /** The engine the view lists with now; none when no Docker program is named. */
  engine(): EngineHost | undefined;
  /** The program `dev.containers.dockerPath` names, as the user wrote it. */
  program(): string;
  /** Opens an untitled JSON document holding `content`. */
  open(content: string): PromiseLike<unknown>;
  /** Shows an error notification with no buttons. */
  showError(text: string): void;
  translate: Translate;
  cancellation: AbortSignal;
}

/** The Docker arguments for the target a command was given; none when it is neither a container row nor an Image row. */
function inspectArgumentsOf(argument: unknown): string[] | undefined {
  const container = containerRowOf(argument);
  if (container !== undefined) {
    return ['inspect', container.id];
  }
  const row = recordOf(argument);
  return row?.viewItem === 'image' &&
    typeof row.description === 'string' &&
    row.description !== ''
    ? ['image', 'inspect', row.description]
    : undefined;
}

/** The first element of the JSON array `docker inspect` printed, as text; none for anything else. */
function firstElementText(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) && parsed.length > 0
      ? JSON.stringify(parsed[0], null, '\t')
      : undefined;
  } catch {
    return undefined;
  }
}

/** The command: inspects the target it is given. */
export function inspectOf(
  ports: InspectPorts,
): (argument: unknown) => Promise<void> {
  return async argument => {
    const argv = inspectArgumentsOf(argument);
    if (argv === undefined) {
      return;
    }
    const outcome = await ports
      .engine()
      ?.run(argv, {kind: 'none'}, {cancellation: ports.cancellation});
    const content =
      outcome?.kind === 'ran' && outcome.status === 0
        ? firstElementText(outcome.stdout)
        : undefined;
    if (content === undefined) {
      ports.showError(
        filled(ports.translate, FAILED_TEMPLATE, [
          `Command failed: ${[ports.program(), ...argv].join(' ')}`,
        ]),
      );
      return;
    }
    await ports.open(content);
  };
}
