/**
 * @fileoverview The reading of `docker inspect` for containers: the JSON array it prints, as the facts discovery
 * decides from, and the mounts of one container.
 */

import {recordOf} from '../json-record.ts';
import type {ContainerFacts} from './labels.ts';

/** The facts of the inspected containers, or the field that could not be read. */
export type InspectedFacts =
  | {kind: 'facts'; containers: ContainerFacts[]}
  | {kind: 'discoveryFailed'; detail: string};

/** The labels of a container: an object of strings, or none. */
function labelsOf(value: unknown): Record<string, string> | undefined {
  const labels = recordOf(value);
  if (labels === undefined) {
    return undefined;
  }
  const entries = Object.entries(labels);
  return entries.every(([, text]) => typeof text === 'string')
    ? (labels as Record<string, string>)
    : undefined;
}

/** The facts of one element of the array, or the name of the first field that is missing or of the wrong type. */
function factsOf(element: unknown): ContainerFacts | string {
  const container = recordOf(element);
  const state = recordOf(container?.State);
  const configuration = recordOf(container?.Config);
  const labels = labelsOf(configuration?.Labels);
  if (typeof container?.Id !== 'string') {
    return 'Id';
  }
  if (typeof container.Created !== 'string') {
    return 'Created';
  }
  if (typeof state?.Status !== 'string') {
    return 'State.Status';
  }
  if (labels === undefined) {
    return 'Config.Labels';
  }
  return {
    id: container.Id,
    created: container.Created,
    status: state.Status,
    labels,
  };
}

/** Reads the output of `docker inspect --type container <ids>`. */
export function inspectedFacts(stdout: string): InspectedFacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {kind: 'discoveryFailed', detail: 'inspect: not JSON'};
  }
  if (!Array.isArray(parsed)) {
    return {kind: 'discoveryFailed', detail: 'inspect: not a list'};
  }
  const containers: ContainerFacts[] = [];
  for (const element of parsed as unknown[]) {
    const facts = factsOf(element);
    if (typeof facts === 'string') {
      return {kind: 'discoveryFailed', detail: `inspect: ${facts}`};
    }
    containers.push(facts);
  }
  return {kind: 'facts', containers};
}

/** Whether the first inspected container has the `vscode` volume mounted at `/vscode`. */
export function hasVscodeVolume(stdout: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return false;
  }
  const first = Array.isArray(parsed)
    ? recordOf((parsed as unknown[])[0])
    : undefined;
  const mounts = first?.Mounts;
  return (
    Array.isArray(mounts) &&
    (mounts as unknown[]).some(mount => {
      const entry = recordOf(mount);
      return (
        entry?.Type === 'volume' &&
        entry.Name === 'vscode' &&
        entry.Destination === '/vscode'
      );
    })
  );
}
