import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

/**
 * The lines of a build's log that show SDKMAN's download came back corrupt and the install gave up on it: the download
 * lines it began, its verdict and the giving up, in order, or none when the log holds not both. A build that failed for another reason gives none, so
 * that only this third-party fault, which no product change can cause, is ever taken for a reason to build again.
 */
export function corruptArchiveLines(lines: readonly string[]): string[] {
  const corrupt = lines.some(line => line.includes('The archive was corrupt'));
  // The verdict alone is not the cause: SDKMAN retries inside the build, so a build that recovered from a corrupt archive
  // and failed for another reason holds it too. The cause is the verdict followed by the install giving up.
  const gaveUp = lines.some(line => /failed after \d+ attempts/.test(line));
  if (!corrupt || !gaveUp) {
    return [];
  }
  return lines
    .filter(line =>
      /Downloading: |The archive was corrupt|failed after \d+ attempts/.test(
        line,
      ),
    )
    .map(line => line.trim());
}

/**
 * The name of that fault for a reader of the red: `SDKMAN served a corrupt <candidate> <version> archive (<its verdict>)`,
 * from the first download line and the verdict of the build's log; none when the log shows no corrupt archive.
 */
export function corruptArchiveName(
  lines: readonly string[],
): string | undefined {
  const shown = corruptArchiveLines(lines);
  const download = /Downloading: (\S+ \S+)/.exec(
    shown.find(line => line.includes('Downloading: ')) ?? '',
  )?.[1];
  const verdict = /(Stop! The archive was corrupt[^.!]*[.!]?)/.exec(
    shown.find(line => line.includes('The archive was corrupt')) ?? '',
  )?.[1];
  return download === undefined || verdict === undefined
    ? undefined
    : `SDKMAN served a corrupt ${download} archive (${verdict.trim()})`;
}

/** SDKMAN's platform name for the machine that runs the rows: Linux on ARM or on x64. */
function platformOf(architecture: string): string {
  return architecture === 'arm64' ? 'linuxarm64' : 'linuxx64';
}

/** SDKMAN's broker address for `download`, as the log names it (`<candidate> <version>`), for Linux on `architecture`; none for any other text. */
export function brokerUrlOf(
  download: string,
  architecture: string = process.arch,
): string | undefined {
  const found = /^(\S+) (\S+)$/u.exec(download.trim());
  return found === null
    ? undefined
    : `https://api.sdkman.io/2/broker/download/${found[1] ?? ''}/${found[2] ?? ''}/${platformOf(architecture)}`;
}

/** What one download of the archive from the machine that runs the rows gave. */
export interface ArchiveProbe {
  /** The status of the last answer, or the reason the request failed. */
  status: string;
  /** The bytes the body held. */
  size: number;
  type: string;
  /** The address the answer came from, once the redirects were followed. */
  url: string;
  /** What `unzip -t` said of the body, or why it could not be run. */
  zipTest: string;
  /** The SHA-256 of the body, to compare with the checksum the broker's own answer names. */
  digest: string;
  /** What the broker answered before any redirect: its status, where it sent the request and every header it names SDKMAN's. */
  broker: string;
}

/** The status, the redirect target and the `x-sdkman` headers of the answer `url` gives before any redirect is followed. */
async function brokerAnswer(url: string): Promise<string> {
  try {
    const answer = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const named = [...answer.headers]
      .filter(([name]) => name === 'location' || name.startsWith('x-sdkman'))
      .map(([name, value]) => `${name}: ${value}`);
    return [String(answer.status), ...named].join('; ');
  } catch (caught) {
    return `the request failed: ${caught instanceof Error ? caught.message : String(caught)}`;
  }
}

/** Downloads `url` once, following redirects, and tests the body as a zip; bounded at 30 s, and it never throws. */
export async function probeArchive(url: string): Promise<ArchiveProbe> {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
    const body = Buffer.from(await response.arrayBuffer());
    const folder = mkdtempSync(path.join(tmpdir(), 'archive-probe-'));
    try {
      const file = path.join(folder, 'archive.zip');
      writeFileSync(file, body);
      const tested = spawnSync('unzip', ['-tq', file], {encoding: 'utf8'});
      return {
        status: String(response.status),
        digest: createHash('sha256').update(body).digest('hex'),
        broker: await brokerAnswer(url),
        size: body.length,
        type: response.headers.get('content-type') ?? '',
        url: response.url,
        zipTest:
          tested.error === undefined
            ? `${tested.stdout}${tested.stderr}`.trim()
            : `unzip could not be run: ${tested.error.message}`,
      };
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  } catch (caught) {
    return {
      status: `the request failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      size: 0,
      type: '',
      url,
      zipTest: '',
      digest: '',
      broker: '',
    };
  }
}

/** The probe as one line for a failure message. */
export function probeText(probe: ArchiveProbe): string {
  return `from this machine the broker first answered ${probe.broker || 'nothing'}; then ${probe.status}, ${String(probe.size)} bytes, sha256 ${probe.digest || 'none'}, content type "${probe.type}", final address ${probe.url}; unzip -t: ${probe.zipTest || 'not run'}`;
}

/**
 * The text of the red of a Feature row whose second build failed after a first that came back corrupt. It blames the third
 * party only when the second build shows the corrupt verdict too; a second build that failed for another reason says so
 * and blames no one.
 */
export function secondBuildText(parts: {
  firstName: string | undefined;
  featureRow: string;
  first: readonly string[];
  second: readonly string[];
  secondMessage: string;
}): string {
  const both = parts.second.length > 0;
  const blame = both
    ? "; this is the third party's fault, not the product's"
    : '; the second build failed for another reason, which this does not blame on the third party';
  return `${parts.firstName ?? 'The first build failed'} and so did the second build of ${parts.featureRow}${blame}. First: ${parts.first.join(' | ')}. Second: ${both ? parts.second.join(' | ') : 'no corrupt-archive verdict'}. ${parts.secondMessage}`;
}
