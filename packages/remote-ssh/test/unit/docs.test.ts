import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');
const GUIDE = path.join(PACKAGE, '..', '..', 'docs', 'remote-ssh');

interface Manifest {
  contributes: {
    commands: Array<{command: string; title: string; category?: string}>;
    configuration: {properties: Record<string, unknown>};
  };
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

const MANIFEST = JSON.parse(
  read(path.join(PACKAGE, 'package.json')),
) as Manifest;
const STRINGS = JSON.parse(
  read(path.join(PACKAGE, 'package.nls.json')),
) as Record<string, string>;

/** The text of every page of the guide. */
function guideText(): string {
  return readdirSync(GUIDE)
    .filter(name => name.endsWith('.md'))
    .map(name => read(path.join(GUIDE, name)))
    .join('\n');
}

/** The distinct matches of the first group of `pattern` in the guide, in order of appearance. */
function mentioned(pattern: RegExp): string[] {
  return [
    ...new Set([...guideText().matchAll(pattern)].map(match => match[1] ?? '')),
  ];
}

/** The command titles as the palette shows them, "Category: Title". */
function paletteTitles(): string[] {
  return MANIFEST.contributes.commands.map(
    command =>
      `${command.category ?? ''}: ${STRINGS[command.title.replaceAll('%', '')] ?? ''}`,
  );
}

describe('the user guide against the manifest', () => {
  it('every setting the guide names is a setting the extension contributes', () => {
    const known = Object.keys(MANIFEST.contributes.configuration.properties);
    deepStrictEqual(
      mentioned(/`(remote\.SSH\.[A-Za-z_.]+)`/g).filter(
        name => !known.includes(name),
      ),
      [],
    );
  });

  it('every command the guide names by its palette title is a command the extension contributes', () => {
    const titles = paletteTitles();
    deepStrictEqual(
      mentioned(/\*\*(Remote-SSH: [^*]+)\*\*/g).filter(
        title => !titles.includes(title),
      ),
      [],
    );
  });
});
