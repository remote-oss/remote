/**
 * @fileoverview The target actions of the Dev Containers view that change a container: Start, Stop and Remove. Each takes
 * the target the editor hands the command, asks for a confirmation where the action destroys or interrupts something, runs
 * the Docker command on the view's own engine and tells the user when it failed. A call without a container target does
 * nothing at all.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import {
  inspectArguments,
  LIST_ARGUMENTS,
  recordOf,
} from './listed-containers.ts';
import type {TargetRow} from './targets-model.ts';

/** The English template of each text of the actions, by its string id. */
const ACTION_TEMPLATES = {
  S168: 'Error removing container: {0}',
  S170: 'Error starting container: {0}',
  S171: 'Error stopping container: {0}',
  S291: 'Remove this container?',
  S335: 'Stop Container',
  S337: 'Stop {0}?',
  S369: 'This action is not reversible and deletes the container permanently.',
  S373: "This is the last container using '{0}'.",
  /** The Remove button of the confirmation; it has no string id of its own. */
  remove: 'Remove',
} as const;

/** The named volume that holds the server and is shared by every container, so it is never "the last" of anything. */
const SHARED_VOLUME = 'vscode';

/** A modal warning with one button besides Cancel. */
export interface Confirmation {
  /** The first line; empty for a dialog that has only a detail. */
  message: string;
  detail: string;
  /** The text of the button that confirms. */
  accept: string;
}

/** What the actions need of their surroundings. */
export interface RowActionPorts {
  /** The engine the view lists with now; none when no Docker program is named. */
  engine(): EngineHost | undefined;
  /** The program `dev.containers.dockerPath` names, as the user wrote it. */
  program(): string;
  /** Shows the dialog and says whether the button that confirms was chosen. */
  confirm(confirmation: Confirmation): Promise<boolean>;
  /** Shows an error notification with no buttons. */
  showError(text: string): void;
  /** Reads the engine again and rebuilds the view. */
  refresh(): Promise<void>;
  translate: Translate;
  cancellation: AbortSignal;
}

/** The three actions, each over the target the command was given. */
export interface RowActions {
  start(argument: unknown): Promise<void>;
  stop(argument: unknown): Promise<void>;
  remove(argument: unknown): Promise<void>;
}

/** The name Docker gives a volume nobody named: 64 hex digits. Such a volume belongs to its one container, so it is no news. */
const ANONYMOUS_VOLUME = /^[0-9a-f]{64}$/;

/** A mount of a container that no other container may share: what it is, and how the user knows it. */
interface Mount {
  key: string;
  shown: string;
}

/** The target a command was given, or none when the argument is not a container target of the view. */
export function containerRowOf(argument: unknown): TargetRow | undefined {
  const target = recordOf(argument);
  return typeof target?.id === 'string' &&
    typeof target.label === 'string' &&
    typeof target.viewItem === 'string' &&
    target.viewItem.split(' ').includes('container')
    ? (target as unknown as TargetRow)
    : undefined;
}

/** The mounts one container of `docker inspect`'s array has, in order, that count towards "the last container". */
function mountsOf(inspected: unknown): Mount[] {
  const mounts = recordOf(inspected)?.Mounts;
  return (Array.isArray(mounts) ? (mounts as unknown[]) : []).flatMap(each => {
    const mount = recordOf(each);
    if (mount?.Type === 'volume' && typeof mount.Name === 'string') {
      return mount.Name === SHARED_VOLUME || ANONYMOUS_VOLUME.test(mount.Name)
        ? []
        : [{key: `volume ${mount.Name}`, shown: mount.Name}];
    }
    return mount?.Type === 'bind' && typeof mount.Source === 'string'
      ? [{key: `bind ${mount.Source}`, shown: mount.Source}]
      : [];
  });
}

/** The elements of the JSON array `docker inspect` printed; none for anything else. */
function elementsOf(stdout: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as unknown[]) : [];
  } catch {
    return [];
  }
}

/** The actions over `ports`. */
export function rowActionsOf(ports: RowActionPorts): RowActions {
  const {translate} = ports;
  const options = {cancellation: ports.cancellation};

  /** The text a failed Docker command is reported as. */
  function failureText(argv: readonly string[]): string {
    return `Command failed: ${[ports.program(), ...argv].join(' ')}`;
  }

  /** Runs `argv` on the engine; what the user is told when it did not exit with 0, else none. */
  async function attempt(argv: readonly string[]): Promise<string | undefined> {
    const outcome = await ports.engine()?.run(argv, {kind: 'none'}, options);
    return outcome?.kind === 'ran' && outcome.status === 0
      ? undefined
      : failureText(argv);
  }

  /** The stdout of a Docker query, or none when it could not be asked. */
  async function printed(argv: readonly string[]): Promise<string> {
    const outcome = await ports.engine()?.run(argv, {kind: 'none'}, options);
    return outcome?.kind === 'ran' && outcome.status === 0
      ? outcome.stdout
      : '';
  }

  /** The lines of S373: each mount of the target that no other container mounts, in mount order. */
  async function lastUserLines(containerId: string): Promise<string[]> {
    const own = mountsOf(
      elementsOf(await printed(inspectArguments([containerId])))[0],
    );
    if (own.length === 0) {
      return [];
    }
    const others = (await printed(LIST_ARGUMENTS))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '' && line !== containerId);
    const used = new Set(
      others.length === 0
        ? []
        : elementsOf(await printed(inspectArguments(others)))
            .flatMap(mountsOf)
            .map(mount => mount.key),
    );
    return own
      .filter(mount => !used.has(mount.key))
      .map(mount => filled(translate, ACTION_TEMPLATES.S373, [mount.shown]));
  }

  /** Tells the user that `template` failed with `argv`. */
  function reportFailure(template: string, argv: readonly string[]): void {
    ports.showError(filled(translate, template, [failureText(argv)]));
  }

  return {
    start: async argument => {
      const target = containerRowOf(argument);
      if (target === undefined) {
        return;
      }
      const argv = ['start', target.id];
      if ((await attempt(argv)) !== undefined) {
        reportFailure(ACTION_TEMPLATES.S170, argv);
      }
    },
    stop: async argument => {
      const target = containerRowOf(argument);
      if (target === undefined) {
        return;
      }
      const confirmed = await ports.confirm({
        message: '',
        detail: filled(translate, ACTION_TEMPLATES.S337, [target.label]),
        accept: translate(ACTION_TEMPLATES.S335),
      });
      const argv = ['stop', target.id];
      if (confirmed && (await attempt(argv)) !== undefined) {
        reportFailure(ACTION_TEMPLATES.S171, argv);
      }
    },
    remove: async argument => {
      const target = containerRowOf(argument);
      if (target === undefined) {
        return;
      }
      const lines = await lastUserLines(target.id);
      const confirmed = await ports.confirm({
        message: translate(ACTION_TEMPLATES.S291),
        detail: [translate(ACTION_TEMPLATES.S369), ...lines].join('\n'),
        accept: translate(ACTION_TEMPLATES.remove),
      });
      if (!confirmed) {
        return;
      }
      if (target.viewItem.split(' ').includes('running')) {
        const stopping = ['stop', target.id];
        if ((await attempt(stopping)) !== undefined) {
          reportFailure(ACTION_TEMPLATES.S171, stopping);
          reportFailure(ACTION_TEMPLATES.S168, stopping);
          return;
        }
      }
      const removing = ['rm', target.id];
      if ((await attempt(removing)) !== undefined) {
        reportFailure(ACTION_TEMPLATES.S168, removing);
        await ports.refresh();
      }
    },
  };
}
