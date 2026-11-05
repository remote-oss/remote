/**
 * @fileoverview Step 1 and 2 of an attached connect: the container the payload names, found by its name and else by the
 * id recorded at the last successful attach of the payload, and what starts or unpauses it when it is not running.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import {
  inspectArguments,
  type ListedContainer,
  listedContainersOf,
} from '../explorer/listed-containers.ts';

/** The ids recorded at successful attaches, by payload. */
export interface IdRecord {
  read(payload: string): string | undefined;
  write(payload: string, containerId: string): PromiseLike<void>;
}

/** What the search found. */
export type Found =
  | {kind: 'found'; container: ListedContainer; viaRecord: boolean}
  | {kind: 'missing'};

/** The container `reference` (a name or an id) as the engine reports it; none when the engine does not know it. */
async function inspected(
  engine: EngineHost,
  reference: string,
  cancellation: AbortSignal,
): Promise<ListedContainer | undefined> {
  const outcome = await engine.run(
    inspectArguments([reference]),
    {kind: 'none'},
    {cancellation},
  );
  return outcome.kind === 'ran' && outcome.status === 0
    ? listedContainersOf(outcome.stdout)?.[0]
    : undefined;
}

/**
 * The container named `containerName` (with the slash Docker keeps). When the name does not resolve, the id recorded
 * for `payload` is tried; a name that resolves wins even when a record exists.
 */
export async function findAttachedContainer(
  engine: EngineHost,
  record: IdRecord,
  payload: string,
  containerName: string,
  cancellation: AbortSignal,
): Promise<Found> {
  const byName = await inspected(
    engine,
    containerName.replace(/^\//, ''),
    cancellation,
  );
  if (byName !== undefined) {
    return {kind: 'found', container: byName, viaRecord: false};
  }
  const recorded = record.read(payload);
  const byRecord =
    recorded === undefined
      ? undefined
      : await inspected(engine, recorded, cancellation);
  return byRecord === undefined
    ? {kind: 'missing'}
    : {kind: 'found', container: byRecord, viaRecord: true};
}

/** The arguments that make `container` run: an unpause for a paused one, a start for any other. */
export function startArguments(container: ListedContainer): string[] {
  return [container.state === 'paused' ? 'unpause' : 'start', container.id];
}

/** Starts or unpauses `container`; whether the engine did it. */
export async function startAttachedContainer(
  engine: EngineHost,
  container: ListedContainer,
  cancellation: AbortSignal,
): Promise<boolean> {
  const outcome = await engine.run(
    startArguments(container),
    {kind: 'none'},
    {cancellation},
  );
  return outcome.kind === 'ran' && outcome.status === 0;
}
