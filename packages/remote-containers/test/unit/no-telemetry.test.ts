import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

/** The sources of the packages that run the connect, which send no telemetry (R-28, F-1405). */
const SOURCE_FOLDERS = [
  path.join(import.meta.dirname, '..', '..', 'src'),
  path.join(import.meta.dirname, '..', '..', '..', 'lib-authority', 'src'),
];

/** The editor's telemetry API and the common reporter packages. */
const TELEMETRY_API =
  /createTelemetryLogger|sendTelemetryEvent|sendTelemetryErrorEvent|TelemetryReporter|applicationinsights|isTelemetryEnabled|onDidChangeTelemetryEnabled/;

/** The source files under `folder`, with their text. */
function sourcesUnder(folder: string): Array<{file: string; text: string}> {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) {
      return sourcesUnder(full);
    }
    return entry.name.endsWith('.ts')
      ? [{file: full, text: readFileSync(full, 'utf8')}]
      : [];
  });
}

describe('the connect sends no telemetry (card containers-53)', () => {
  it('F-0408 AC-25 (no-telemetry): no source of the connect uses the editor’s telemetry API or a reporter package', () => {
    deepStrictEqual(
      SOURCE_FOLDERS.flatMap(sourcesUnder)
        .filter(source => TELEMETRY_API.test(source.text))
        .map(source => path.basename(source.file)),
      [],
    );
  });
});
