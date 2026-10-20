import {deepStrictEqual, rejects} from 'node:assert';
import {
  type AddHostPorts,
  addNewSshHostHandler,
  type HostFiles,
} from '../../src/config/add-host-command.ts';
import type {FileChoice, FileChoiceItem} from '../../src/config/file-choice.ts';
import type {ConfigFilePlaces} from '../../src/config/open-config-file.ts';

const HOME = '/home/a';
const PLACES: ConfigFilePlaces = {
  homeFolder: HOME,
  platform: 'linux',
  userFile: `${HOME}/.ssh/config`,
  systemFile: '/etc/ssh/ssh_config',
};

/** One thing the command did, in order. */
type Step = string;

/** The client, its files and the editor, as one command run sees them. */
interface World {
  steps: Step[];
  /** The text of each file that exists; a folder is a key ending with `/`. */
  disk: Map<string, string>;
  /** What the input gives; nothing for Escape. */
  typed: string | undefined;
  /** The row taken in the file picker by its kind and path; nothing for Escape. */
  take: (choice: FileChoice) => FileChoiceItem | undefined;
  /** The button taken in the notice; nothing when it is dismissed. */
  button: string | undefined;
  configFile: string;
  writeFailure: Error | undefined;
  requests: unknown[];
  choices: FileChoice[];
  notices: Array<{severity: string; message: string; buttons: string[]}>;
  opened: string[];
  windows: Array<[string, string]>;
  /** The steps and the notices shown when each hosts-changed signal was sent. */
  signals: Array<{steps: Step[]; notices: number}>;
}

function takeFile(label: string): World['take'] {
  return choice =>
    choice.items.find(item => item.kind === 'file' && item.label === label);
}

function worldWith(changes: Partial<World> = {}): World {
  return {
    steps: [],
    disk: new Map([[`${HOME}/`, '']]),
    typed: 'host1',
    take: takeFile(PLACES.userFile),
    button: undefined,
    configFile: '',
    writeFailure: undefined,
    requests: [],
    choices: [],
    notices: [],
    opened: [],
    signals: [],
    windows: [],
    ...changes,
  };
}

function filesOf(world: World): HostFiles {
  return {
    exists: file => Promise.resolve(world.disk.has(file)),
    missingFolders: file => {
      const missing: string[] = [];
      for (
        let folder = file.slice(0, file.lastIndexOf('/'));
        folder !== '' && !world.disk.has(`${folder}/`);
        folder = folder.slice(0, folder.lastIndexOf('/'))
      ) {
        missing.unshift(folder);
      }
      return Promise.resolve(missing);
    },
    makeFolder: (folder, mode) => {
      world.disk.set(`${folder}/`, '');
      world.steps.push(`folder ${folder} ${mode.toString(8)}`);
      return Promise.resolve();
    },
    createFile: (file, mode) => {
      world.disk.set(file, '');
      world.steps.push(`file ${file} ${mode.toString(8)}`);
      return Promise.resolve();
    },
    read: file => {
      world.steps.push('read');
      return Promise.resolve(world.disk.get(file) ?? '');
    },
    write: (file, text) => {
      if (world.writeFailure !== undefined) {
        return Promise.reject(world.writeFailure);
      }
      world.disk.set(file, text);
      world.steps.push('write');
      return Promise.resolve();
    },
  };
}

function portsOf(world: World): AddHostPorts {
  return {
    hostsChanged: () => {
      world.signals.push({
        steps: [...world.steps],
        notices: world.notices.length,
      });
    },
    editor: {
      pickFile: choice => {
        world.steps.push('pick');
        world.choices.push(choice);
        return Promise.resolve(world.take(choice));
      },
      open: file => {
        world.opened.push(file);
        return Promise.resolve({file});
      },
    },
    windows: {
      openRemote: (authority, window) => {
        world.windows.push([authority, window]);
        return Promise.resolve();
      },
    },
    input: {
      showInputBox: request => {
        world.steps.push('input');
        world.requests.push(request);
        return Promise.resolve(world.typed);
      },
    },
    notice: {
      showInformation: (message, buttons) => {
        world.notices.push({
          severity: 'information',
          message,
          buttons: [...buttons],
        });
        return Promise.resolve(world.button);
      },
      showWarning: () => Promise.resolve(undefined),
      showError: (message, buttons) => {
        world.notices.push({severity: 'error', message, buttons: [...buttons]});
        return Promise.resolve(undefined);
      },
    },
    files: filesOf(world),
    places: PLACES,
    configFile: () => world.configFile,
    translate: template => template,
  };
}

async function execute(world: World): Promise<void> {
  await addNewSshHostHandler(portsOf(world)).execute();
}

/** The text of the user file after a run. */
function written(world: World): string | undefined {
  return world.disk.get(PLACES.userFile);
}

describe('the command that adds a host (card connect-22)', () => {
  it('F-2204 AC-2: the input has the title and the placeholder and no prompt', async () => {
    const world = worldWith({typed: undefined});
    await execute(world);
    deepStrictEqual(world.requests, [
      {
        title: 'Enter SSH Connection Command',
        placeholder: 'E.g. ssh hello@example.com -A',
      },
    ]);
  });

  it('F-2204 AC-3: Escape at the input shows nothing and writes nothing', async () => {
    const world = worldWith({typed: undefined});
    await execute(world);
    deepStrictEqual([world.steps, world.notices], [['input'], []]);
  });

  it('F-2204 AC-4: an input of spaces shows nothing and writes nothing', async () => {
    const world = worldWith({typed: '   '});
    await execute(world);
    deepStrictEqual([world.steps, world.notices], [['input'], []]);
  });

  it('F-2204 AC-21: a command without a host shows an error notice with no buttons', async () => {
    const world = worldWith({typed: 'ssh -p 22'});
    await execute(world);
    deepStrictEqual(world.notices, [
      {
        severity: 'error',
        message: 'Missing host in SSH connection string',
        buttons: [],
      },
    ]);
  });

  it('F-2204 AC-21: a command without a host opens no file picker and writes nothing', async () => {
    const world = worldWith({typed: 'ssh'});
    await execute(world);
    deepStrictEqual(world.steps, ['input']);
  });

  it('F-2204 AC-22: an unknown flag names its letter', async () => {
    const world = worldWith({typed: 'ssh -Z x host'});
    await execute(world);
    deepStrictEqual(
      world.notices.map(notice => notice.message),
      ['Unknown flag Z'],
    );
  });

  it('F-2204 AC-23: a flag without its argument names the flag', async () => {
    const world = worldWith({typed: 'ssh host48 -p'});
    await execute(world);
    deepStrictEqual(
      world.notices.map(notice => notice.message),
      ['Expected flag -p to have an argument but it did not'],
    );
  });

  it('F-2204 AC-24: an option value without = gives the whole value', async () => {
    const world = worldWith({typed: 'ssh -o "ProxyCommand nc %h %p" host'});
    await execute(world);
    deepStrictEqual(
      world.notices.map(notice => notice.message),
      ['Argument missing for option ProxyCommand nc %h %p'],
    );
  });

  it('F-2204 AC-25: an unquoted shell character is an error notice that names it', async () => {
    const world = worldWith({typed: 'host50;id'});
    await execute(world);
    deepStrictEqual(
      world.notices.map(notice => notice.message),
      ['Unquoted shell character ";" in the SSH connection command'],
    );
  });

  it('F-2204 AC-25: an unquoted shell character opens no file picker', async () => {
    const world = worldWith({typed: 'host66(x)'});
    await execute(world);
    deepStrictEqual(world.steps, ['input']);
  });

  it('F-2204 AC-5: without a configured file the picker lists the user and system files, Settings and Help', async () => {
    const world = worldWith({take: () => undefined});
    await execute(world);
    deepStrictEqual(
      world.choices.flatMap(choice =>
        choice.items.map(item =>
          item.kind === 'file' ? item.label : item.kind,
        ),
      ),
      [PLACES.userFile, PLACES.systemFile, 'settings', 'help'],
    );
  });

  it('F-2204 AC-32: with a configured file the picker lists it, Settings and Help', async () => {
    const world = worldWith({
      configFile: '/etc/ssh/mine',
      take: () => undefined,
    });
    await execute(world);
    deepStrictEqual(
      world.choices.flatMap(choice =>
        choice.items.map(item =>
          item.kind === 'file' ? item.label : item.kind,
        ),
      ),
      ['/etc/ssh/mine', 'settings', 'help'],
    );
  });

  it('F-2204 AC-34: Escape at the file picker writes nothing and shows nothing', async () => {
    const world = worldWith({take: () => undefined});
    await execute(world);
    deepStrictEqual([world.steps, world.notices], [['input', 'pick'], []]);
  });

  it('F-2204 AC-34: the Settings row writes nothing and shows nothing', async () => {
    const world = worldWith({
      take: choice => choice.items.find(item => item.kind === 'settings'),
    });
    await execute(world);
    deepStrictEqual([world.steps, world.notices], [['input', 'pick'], []]);
  });

  it('F-2204 AC-34: the Help row writes nothing and shows nothing', async () => {
    const world = worldWith({
      take: choice => choice.items.find(item => item.kind === 'help'),
    });
    await execute(world);
    deepStrictEqual([world.steps, world.notices], [['input', 'pick'], []]);
  });

  it('F-2204 AC-6: a home without .ssh gets the folder and the file, then the two lines', async () => {
    const world = worldWith();
    await execute(world);
    deepStrictEqual(written(world), 'Host host1\n  HostName host1\n');
  });

  it('F-2204 AC-6: the new user folder is 0700 and the new file 0600', async () => {
    const world = worldWith();
    await execute(world);
    deepStrictEqual(world.steps.slice(2, 4), [
      `folder ${HOME}/.ssh 700`,
      `file ${HOME}/.ssh/config 600`,
    ]);
  });

  it('F-2204 AC-17: the block goes before the first Host line of a file that exists', async () => {
    const world = worldWith();
    world.disk.set(PLACES.userFile, '# mine\nHost old\n  HostName old\n');
    await execute(world);
    deepStrictEqual(
      written(world),
      '# mine\nHost host1\n  HostName host1\n\nHost old\n  HostName old\n',
    );
  });

  it('F-2204 AC-33: a configured file in missing folders gets them, then the file, in 0755 and 0644', async () => {
    const world = worldWith({
      configFile: '/srv/ssh/deep/config',
      take: takeFile('/srv/ssh/deep/config'),
    });
    world.disk.set('/srv/', '');
    await execute(world);
    deepStrictEqual(world.steps.slice(2, 5), [
      'folder /srv/ssh 755',
      'folder /srv/ssh/deep 755',
      'file /srv/ssh/deep/config 644',
    ]);
  });

  it('F-2204 AC-39: the file is read after it is picked, so a change made meanwhile is kept', async () => {
    const world = worldWith();
    world.disk.set(PLACES.userFile, 'Host a\n');
    world.take = choice => {
      world.disk.set(PLACES.userFile, 'Host changed\n');
      return takeFile(PLACES.userFile)(choice);
    };
    await execute(world);
    deepStrictEqual(
      written(world),
      'Host host1\n  HostName host1\n\nHost changed\n',
    );
  });

  it("F-2201 AC-20: a picked file that cannot be parsed fails with the reader's message and is left unchanged", async () => {
    const world = worldWith({
      disk: new Map([
        [`${HOME}/`, ''],
        [`${HOME}/.ssh/`, ''],
        [PLACES.userFile, 'Host "broken\n'],
      ]),
    });
    const failure = await execute(world).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    );
    deepStrictEqual(
      [
        failure,
        world.disk.get(PLACES.userFile),
        world.steps,
        world.notices,
        world.opened,
      ],
      [
        `${PLACES.userFile}: unterminated quote after Host`,
        'Host "broken\n',
        ['input', 'pick', 'read'],
        [],
        [],
      ],
    );
  });

  it('F-2201 AC-20: a picked file that parses is read once and written', async () => {
    const world = worldWith();
    world.disk.set(PLACES.userFile, 'Host old\n  HostName a\n');
    await execute(world);
    deepStrictEqual(world.steps, ['input', 'pick', 'read', 'write']);
  });

  it('F-2204 §16: a run that wrote the block sends one signal, right after the write and before the notice', async () => {
    const world = worldWith();
    await execute(world);
    deepStrictEqual(world.signals, [
      {
        steps: [
          'input',
          'pick',
          `folder ${HOME}/.ssh 700`,
          `file ${PLACES.userFile} 600`,
          'write',
        ],
        notices: 0,
      },
    ]);
  });

  it('F-2204 §16: a cancelled run, a parse problem and a failed write send no signal', async () => {
    const signals: number[] = [];
    for (const world of [
      worldWith({typed: undefined}),
      worldWith({typed: 'host50;id'}),
      worldWith({writeFailure: new Error('EACCES')}),
    ]) {
      await execute(world).catch(() => undefined);
      signals.push(world.signals.length);
    }
    deepStrictEqual(signals, [0, 0, 0]);
  });

  it('F-2204 AC-26: a file that cannot be written rejects with the system error', async () => {
    const failure = new Error("EACCES: permission denied, open '/x'");
    const world = worldWith({writeFailure: failure});
    await rejects(execute(world), failure);
  });

  it('F-2204 AC-26: a file that cannot be written shows no Host added notice', async () => {
    const world = worldWith({writeFailure: new Error('EACCES')});
    await execute(world).catch(() => undefined);
    deepStrictEqual(world.notices, []);
  });

  it('F-2204 AC-7: the notice says Host added with Open Config and Connect in that order', async () => {
    const world = worldWith();
    await execute(world);
    deepStrictEqual(world.notices, [
      {
        severity: 'information',
        message: 'Host added!',
        buttons: ['Open Config', 'Connect'],
      },
    ]);
  });

  it('F-2204 AC-8: Open Config opens the file written', async () => {
    const world = worldWith({button: 'Open Config'});
    await execute(world);
    deepStrictEqual(world.opened, [PLACES.userFile]);
  });

  it('F-2204 AC-9: Connect opens a new window on the alias written', async () => {
    const world = worldWith({
      typed: 'ssh -p 2222 bob@devbox',
      button: 'Connect',
    });
    await execute(world);
    deepStrictEqual(world.windows, [['ssh-remote+devbox', 'new']]);
  });

  it('F-2204 AC-9: Connect opens no editor', async () => {
    const world = worldWith({button: 'Connect'});
    await execute(world);
    deepStrictEqual(world.opened, []);
  });

  it('F-2204 AC-7: a dismissed notice opens neither the file nor a window', async () => {
    const world = worldWith({button: undefined});
    await execute(world);
    deepStrictEqual([world.opened, world.windows], [[], []]);
  });
});
