import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

/** What a scan of a folder read and found. */
export interface StoredScan {
  /** The regular files the scan read, relative to the folder. */
  read: string[];
  /** The files under the folder, relative to it, whose text holds the searched text. */
  holding: string[];
}

/**
 * Reads every regular file under `folder`, at any depth, and gives those that hold `text`. A folder that is not there
 * holds nothing; any other failure to read ends the scan with an error that names the path, so that a scan that
 * could not read never passes for one that found nothing.
 */
export function scanStored(folder: string, text: string): StoredScan {
  let entries;
  try {
    entries = readdirSync(folder, {recursive: true, withFileTypes: true});
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') {
      return {read: [], holding: []};
    }
    throw new Error(`the scan of ${folder} failed: ${String(caught)}`, {
      cause: caught,
    });
  }
  const scan: StoredScan = {read: [], holding: []};
  for (const entry of entries.filter(each => each.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch (caught) {
      throw new Error(`the scan could not read ${file}: ${String(caught)}`, {
        cause: caught,
      });
    }
    const relative = path.relative(folder, file);
    scan.read.push(relative);
    if (content.includes(text)) {
      scan.holding.push(relative);
    }
  }
  return scan;
}
