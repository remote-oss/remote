/**
 * @fileoverview What the rows that watch a connect share: a reader that samples a window's surfaces until it is told to
 * stop, and the connecting toasts among the samples.
 */

import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {devContainerFolder, editorLogsFolder, variable} from './harness.ts';
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

/** The Dev Containers log files the editor has written so far, one for each window that ran the extension. */
export function windowLogFiles(): string[] {
  const logs = editorLogsFolder();
  return existsSync(logs)
    ? readdirSync(logs, {recursive: true, encoding: 'utf8'}).filter(
        file => path.basename(file) === '1-Dev Containers.log',
      )
    : [];
}

/**
 * When the resolve began in the windows whose logs are `files`, from the log's own `Resolving Remote` line; NaN when
 * none has one. The harness cannot read a window while it reloads, so a pause is counted from this time.
 */
export function resolveStartedAt(files: readonly string[]): number {
  const found = files
    .flatMap(file =>
      readFileSync(path.join(editorLogsFolder(), file), 'utf8').split('\n'),
    )
    .map(line => /^(\S+) \[info\] Resolving Remote$/.exec(line)?.[1])
    .find(each => each !== undefined);
  return Date.parse(found ?? '');
}
