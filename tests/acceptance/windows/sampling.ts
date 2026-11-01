/**
 * @fileoverview What the rows that watch a connect share: a reader that samples a window's surfaces until it is told to
 * stop, and the connecting toasts among the samples.
 */

import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {devContainerFolder, variable} from './harness.ts';
import {statusBarText, toastDetails, type ToastDetails} from './renderer.ts';

/** One reading of the window: when it was taken, the toasts, and the remote indicator's text. */
export interface Sample {
  takenAt: number;
  toasts: ToastDetails[];
  indicator: string;
}

/** Reads every 100 ms until `stop` is called; a reading that fails because the window reloads is skipped. */
export function sampled<Reading>(
  read: () => Promise<Reading>,
  pauseMilliseconds = 100,
): {
  stop(): Promise<Reading[]>;
} {
  const readings: Reading[] = [];
  const gate = {done: false};
  const loop = (async () => {
    while (!gate.done) {
      try {
        readings.push(await read());
      } catch {
        // The window is reloading.
      }
      await new Promise(resolve => setTimeout(resolve, pauseMilliseconds));
    }
  })();
  return {
    stop: async () => {
      gate.done = true;
      await loop;
      return readings;
    },
  };
}

/** Samples window `name`'s toasts and remote indicator every 100 ms until `stop` is called. */
export function sampling(name: string): {stop(): Promise<Sample[]>} {
  return sampled(async () => ({
    takenAt: Date.now(),
    toasts: await toastDetails(name),
    indicator: await statusBarText(name, 'status.host'),
  }));
}

/** The connecting toasts of every sample, in order. */
export function connectingOf(samples: readonly Sample[]): ToastDetails[] {
  return samples.flatMap(sample =>
    sample.toasts.filter(toast => toast.message.startsWith('Connecting')),
  );
}

/** A folder that builds a Dockerfile with a slow step, so the connect lasts long enough to be sampled. */
export function slowBuildFolder(
  folderName: string,
  title: string,
  step = 'sleep 5',
): string {
  const folder = devContainerFolder(folderName, {
    name: title,
    image: undefined,
    build: {dockerfile: 'Dockerfile'},
  });
  writeFileSync(
    path.join(folder, '.devcontainer', 'Dockerfile'),
    `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN ${step}; echo ${folderName}-${String(Date.now())}\n`,
  );
  return folder;
}
