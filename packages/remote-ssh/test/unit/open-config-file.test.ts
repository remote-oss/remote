import {deepStrictEqual, rejects} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import type {FileChoice, FileChoiceItem} from '../../src/config/file-choice.ts';
import type {Template} from '../../src/config/new-file.ts';
import {starterTemplate} from '../../src/config/new-file.ts';
import {
  type ConfigFileActions,
  type ConfigFileEditor,
  type ConfigFilePlaces,
  type ConfigFiles,
  type OpenedEditor,
  CONFIG_FILE_HELP_ADDRESS,
  openConfigFileHandler,
} from '../../src/config/open-config-file.ts';

const HOME = '/home/a';
const PLACES: ConfigFilePlaces = {
  homeFolder: HOME,
  platform: 'linux',
  userFile: `${HOME}/.ssh/config`,
  systemFile: '/etc/ssh/ssh_config',
};
const EXTENSION = {
  id: 'remote-oss.remote-ssh',
  pack: ['remote-oss.remote-ssh-edit', 'remote-oss.remote-explorer'],
};

/** Everything one run did, in order. */
type Call =
  | {call: 'pick'; choice: FileChoice}
  | {call: 'open'; file: string; opened: OpenedEditor}
  | {call: 'insert'; opened: OpenedEditor; template: Template}
  | {call: 'exists'; path: string}
  | {call: 'missing'; file: string}
  | {call: 'folder'; path: string; mode: number}
  | {call: 'file'; path: string; mode: number}
  | {call: 'settings'; query: string}
  | {call: 'help'};

interface World {
  calls: Call[];
  existing: Set<string>;
  /** The row the user takes, by a test; none for Escape. */
  take: (choice: FileChoice) => FileChoiceItem | undefined;
  fileFailure: Error | undefined;
  configFile: string;
}

function worldWith(changes: Partial<World> = {}): World {
  return {
    calls: [],
    existing: new Set<string>(),
    take: () => undefined,
    fileFailure: undefined,
    configFile: '',
    ...changes,
  };
}

function handlerOf(world: World) {
  const editor: ConfigFileEditor = {
    pickFile: choice => {
      world.calls.push({call: 'pick', choice});
      return Promise.resolve(world.take(choice));
    },
    open: file => {
      const opened: OpenedEditor = {file};
      world.calls.push({call: 'open', file, opened});
      return Promise.resolve(opened);
    },
    insertTemplate: (opened, template) => {
      world.calls.push({call: 'insert', opened, template});
      return Promise.resolve();
    },
  };
  const files: ConfigFiles = {
    exists: path => {
      world.calls.push({call: 'exists', path});
      return Promise.resolve(world.existing.has(path));
    },
    missingFolders: file => {
      world.calls.push({call: 'missing', file});
      const missing: string[] = [];
      let folder = file.slice(0, file.lastIndexOf('/'));
      while (folder !== '' && !world.existing.has(folder)) {
        missing.unshift(folder);
        folder = folder.slice(0, folder.lastIndexOf('/'));
      }
      return Promise.resolve(missing);
    },
    makeFolder: (path, mode) => {
      world.calls.push({call: 'folder', path, mode});
      world.existing.add(path);
      return Promise.resolve();
    },
    createFile: (path, mode) => {
      if (world.fileFailure !== undefined) {
        return Promise.reject(world.fileFailure);
      }
      world.calls.push({call: 'file', path, mode});
      world.existing.add(path);
      return Promise.resolve();
    },
  };
  const actions: ConfigFileActions = {
    openSettings: query => {
      world.calls.push({call: 'settings', query});
      return Promise.resolve();
    },
    openHelp: () => {
      world.calls.push({call: 'help'});
      return Promise.resolve();
    },
  };
  return openConfigFileHandler(
    editor,
    files,
    actions,
    PLACES,
    () => world.configFile,
    EXTENSION,
    template => template,
  );
}

/** The row of the file at `label` among the rows shown. */
function rowOf(choice: FileChoice, label: string): FileChoiceItem {
  const found = choice.items.find(
    item => item.kind === 'file' && item.label === label,
  );
  if (found === undefined) {
    throw new Error(`no row for ${label}`);
  }
  return found;
}

function rowKind(
  choice: FileChoice,
  kind: 'settings' | 'help',
): FileChoiceItem {
  const found = choice.items.find(item => item.kind === kind);
  if (found === undefined) {
    throw new Error(`no ${kind} row`);
  }
  return found;
}

/** The calls of one run that took the file row at `label`. */
async function runTaking(world: World, label: string): Promise<Call[]> {
  world.take = choice => rowOf(choice, label);
  await handlerOf(world).execute();
  return world.calls.filter(call => call.call !== 'pick');
}

describe('the Open SSH Configuration File command (card remote-ssh-19)', () => {
  /** The placeholder id and the number of rows of the first picker a run shows. */
  async function firstPicker(
    configFile: string,
  ): Promise<[string, number] | undefined> {
    const world = worldWith({configFile});
    await handlerOf(world).execute();
    const [first] = world.calls;
    return first?.call === 'pick'
      ? [first.choice.placeholder.id, first.choice.items.length]
      : undefined;
  }

  it('F-2203 AC-2: with no configured file the four rows are shown, asking to select one', async () => {
    deepStrictEqual(await firstPicker(''), ['S126', 4]);
  });

  it('F-2203 AC-11: with a configured file its three rows are shown, asking to edit it', async () => {
    deepStrictEqual(await firstPicker('/x/my_config'), ['S047', 3]);
  });

  it('F-2203 BR-1: the setting is read at each run', async () => {
    const world = worldWith({configFile: '/x/one'});
    const handler = handlerOf(world);
    await handler.execute();
    world.configFile = '/x/two';
    await handler.execute();
    deepStrictEqual(
      world.calls.flatMap(call =>
        call.call === 'pick'
          ? call.choice.items.flatMap(item =>
              item.kind === 'file' ? [item.label] : [],
            )
          : [],
      ),
      ['/x/one', '/x/two'],
    );
  });

  it('F-2203 AC-16: dismissing the pick creates and opens nothing', async () => {
    const world = worldWith();
    await handlerOf(world).execute();
    deepStrictEqual(
      world.calls.filter(call => call.call !== 'pick'),
      [],
    );
  });

  it('F-2203 AC-3: an existing user file is opened, with nothing created and no template', async () => {
    const world = worldWith({existing: new Set([PLACES.userFile])});
    deepStrictEqual(await runTaking(world, PLACES.userFile), [
      {call: 'exists', path: PLACES.userFile},
      {call: 'open', file: PLACES.userFile, opened: {file: PLACES.userFile}},
    ]);
  });

  it('F-2203 AC-5: a user file and its folder that are missing are made, the folder first, then the file is opened', async () => {
    const world = worldWith({existing: new Set([HOME])});
    deepStrictEqual(
      (await runTaking(world, PLACES.userFile)).filter(
        call =>
          call.call === 'folder' ||
          call.call === 'file' ||
          call.call === 'open',
      ),
      [
        {call: 'folder', path: `${HOME}/.ssh`, mode: 0o700},
        {call: 'file', path: PLACES.userFile, mode: 0o600},
        {call: 'open', file: PLACES.userFile, opened: {file: PLACES.userFile}},
      ],
    );
  });

  it('F-2203 AC-31: with the folder in place only the file is made', async () => {
    const world = worldWith({existing: new Set([HOME, `${HOME}/.ssh`])});
    deepStrictEqual(
      (await runTaking(world, PLACES.userFile)).filter(
        call => call.call === 'file' || call.call === 'folder',
      ),
      [{call: 'file', path: PLACES.userFile, mode: 0o600}],
    );
  });

  it('F-2203 AC-6: a created file gets the starter template after it is opened', async () => {
    const world = worldWith({existing: new Set([HOME, `${HOME}/.ssh`])});
    const calls = await runTaking(world, PLACES.userFile);
    deepStrictEqual(calls.slice(-2), [
      {call: 'open', file: PLACES.userFile, opened: {file: PLACES.userFile}},
      {
        call: 'insert',
        opened: {file: PLACES.userFile},
        template: starterTemplate({insertSpaces: true, tabSize: 4}),
      },
    ]);
  });

  it('F-2203 AC-9: an existing file, empty or not, gets no template', async () => {
    const world = worldWith({existing: new Set([PLACES.userFile])});
    deepStrictEqual(
      (await runTaking(world, PLACES.userFile)).filter(
        call => call.call === 'insert',
      ),
      [],
    );
  });

  it('F-2203 AC-10: an existing system file is opened and nothing is created', async () => {
    const world = worldWith({existing: new Set([PLACES.systemFile])});
    deepStrictEqual(await runTaking(world, PLACES.systemFile), [
      {call: 'exists', path: PLACES.systemFile},
      {
        call: 'open',
        file: PLACES.systemFile,
        opened: {file: PLACES.systemFile},
      },
    ]);
  });

  it('F-2203 Q2: a missing system file in an existing folder is made with the configured mode and the template', async () => {
    const world = worldWith({existing: new Set(['/etc/ssh'])});
    deepStrictEqual(
      (await runTaking(world, PLACES.systemFile))
        .filter(call => call.call !== 'missing')
        .map(call => call.call),
      ['exists', 'file', 'open', 'insert'],
    );
  });

  it('F-2203 Q2: the system file takes the mode 0644', async () => {
    const world = worldWith({existing: new Set(['/etc/ssh'])});
    deepStrictEqual(
      (await runTaking(world, PLACES.systemFile)).find(
        call => call.call === 'file',
      ),
      {call: 'file', path: PLACES.systemFile, mode: 0o644},
    );
  });

  it('F-2203 AC-12: a configured file in missing folders makes them outermost first with the configured modes', async () => {
    const world = worldWith({
      configFile: '/x/a/b/my_config',
      existing: new Set(['/x']),
    });
    deepStrictEqual(
      (await runTaking(world, '/x/a/b/my_config')).filter(
        call =>
          call.call === 'folder' ||
          call.call === 'file' ||
          call.call === 'open',
      ),
      [
        {call: 'folder', path: '/x/a', mode: 0o755},
        {call: 'folder', path: '/x/a/b', mode: 0o755},
        {call: 'file', path: '/x/a/b/my_config', mode: 0o644},
        {
          call: 'open',
          file: '/x/a/b/my_config',
          opened: {file: '/x/a/b/my_config'},
        },
      ],
    );
  });

  it('F-2203 AC-13: a leading ~ in the configured file is the home folder, and no folder is named ~', async () => {
    const world = worldWith({
      configFile: '~/cfg/my_config',
      existing: new Set([HOME]),
    });
    deepStrictEqual(
      (await runTaking(world, '~/cfg/my_config')).filter(
        call => call.call === 'open',
      ),
      [
        {
          call: 'open',
          file: `${HOME}/cfg/my_config`,
          opened: {file: `${HOME}/cfg/my_config`},
        },
      ],
    );
  });

  it('F-2203 AC-32: a relative configured file is refused, with the absolute-path text as the command error', async () => {
    const world = worldWith({
      configFile: 'relcfg/rel_config',
      existing: new Set([HOME]),
    });
    world.take = choice => rowOf(choice, 'relcfg/rel_config');
    await rejects(
      Promise.resolve(handlerOf(world).execute()),
      new Error(
        'remote.SSH.configFile must be an absolute path or start with ~/: "relcfg/rel_config"',
      ),
    );
  });

  it('F-2203 AC-23: the refusal asks the file ports nothing and opens nothing', async () => {
    const world = worldWith({
      configFile: 'relcfg/rel_config',
      existing: new Set([HOME]),
    });
    world.take = choice => rowOf(choice, 'relcfg/rel_config');
    await Promise.resolve(handlerOf(world).execute()).catch(() => undefined);
    deepStrictEqual(
      world.calls.filter(call => call.call !== 'pick'),
      [],
    );
  });

  it('F-2203 7.E3: a configured ~/cfg with the file missing opens the home folder path, as before', async () => {
    const world = worldWith({configFile: '~/cfg', existing: new Set([HOME])});
    deepStrictEqual(
      (await runTaking(world, '~/cfg')).filter(call => call.call === 'open'),
      [{call: 'open', file: `${HOME}/cfg`, opened: {file: `${HOME}/cfg`}}],
    );
  });

  it('#408 (1), F-2201 BR-4: a configured file of ~ alone is the home folder', async () => {
    const world = worldWith({configFile: '~'});
    deepStrictEqual(
      (await runTaking(world, '~')).filter(call => call.call === 'open'),
      [{call: 'open', file: HOME, opened: {file: HOME}}],
    );
  });

  it('#408 (1), F-2203 7.E3: on Linux a backslash after the ~ is not expanded, so the value is refused', async () => {
    const world = worldWith({configFile: '~\\cfg\\c'});
    world.take = choice => rowOf(choice, '~\\cfg\\c');
    await rejects(
      Promise.resolve(handlerOf(world).execute()),
      new Error(
        'remote.SSH.configFile must be an absolute path or start with ~/: "~\\cfg\\c"',
      ),
    );
  });

  it('#408 (2): insertTemplate gets the very object open returned', async () => {
    const world = worldWith({existing: new Set([HOME, `${HOME}/.ssh`])});
    const calls = await runTaking(world, PLACES.userFile);
    const opened = calls.find(call => call.call === 'open');
    const insert = calls.find(call => call.call === 'insert');
    deepStrictEqual(
      [
        opened?.call === 'open' &&
          insert?.call === 'insert' &&
          insert.opened === opened.opened,
        insert?.call === 'insert' && insert.template,
      ],
      [true, starterTemplate({insertSpaces: true, tabSize: 4})],
    );
  });

  it('#408 (3): the missing folders are not asked when the file exists', async () => {
    const world = worldWith({existing: new Set([PLACES.userFile])});
    deepStrictEqual(
      (await runTaking(world, PLACES.userFile)).filter(
        call => call.call === 'missing',
      ),
      [],
    );
  });

  it('F-2203 AC-21, AC-30: a file that cannot be created rejects the command and opens nothing', async () => {
    const failure = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    const world = worldWith({
      existing: new Set([HOME, `${HOME}/.ssh`]),
      fileFailure: failure,
    });
    world.take = choice => rowOf(choice, PLACES.userFile);
    await rejects(Promise.resolve(handlerOf(world).execute()), failure);
  });

  it('F-2203 AC-21: after that rejection nothing was opened', async () => {
    const world = worldWith({
      existing: new Set([HOME, `${HOME}/.ssh`]),
      fileFailure: new Error('permission denied'),
    });
    world.take = choice => rowOf(choice, PLACES.userFile);
    await Promise.resolve(handlerOf(world).execute()).catch(() => undefined);
    deepStrictEqual(
      world.calls.filter(call => call.call === 'open'),
      [],
    );
  });

  it('F-2203 AC-14, F-2201 AC-6: the Settings row opens the settings of the extension and its pack, and creates nothing', async () => {
    const world = worldWith();
    world.take = choice => rowKind(choice, 'settings');
    await handlerOf(world).execute();
    deepStrictEqual(
      world.calls.filter(call => call.call !== 'pick'),
      [
        {
          call: 'settings',
          query:
            '@ext:remote-oss.remote-ssh,remote-oss.remote-ssh-edit,remote-oss.remote-explorer config file',
        },
      ],
    );
  });

  it('F-2203 AC-15, F-2201 AC-7: the Help row opens the help once and creates nothing', async () => {
    const world = worldWith();
    world.take = choice => rowKind(choice, 'help');
    await handlerOf(world).execute();
    deepStrictEqual(
      world.calls.filter(call => call.call !== 'pick'),
      [{call: 'help'}],
    );
  });

  it("F-2201 AC-7: the Help row's page is the project's own", () => {
    const prefix = 'https://github.com/remote-oss/remote/blob/main/';
    const root = path.join(import.meta.dirname, '..', '..', '..', '..');
    deepStrictEqual(
      [
        CONFIG_FILE_HELP_ADDRESS.startsWith(prefix),
        existsSync(
          path.join(root, CONFIG_FILE_HELP_ADDRESS.slice(prefix.length)),
        ),
      ],
      [true, true],
    );
  });

  it('F-2203 BR-8: a whole run writes no setting or state, only what the ports record', async () => {
    const world = worldWith({existing: new Set([HOME])});
    await runTaking(world, PLACES.userFile);
    deepStrictEqual([...new Set(world.calls.map(call => call.call))].sort(), [
      'exists',
      'file',
      'folder',
      'insert',
      'missing',
      'open',
      'pick',
    ]);
  });
});
